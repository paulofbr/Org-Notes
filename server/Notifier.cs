using System.Diagnostics;
using System.Security;
using System.Text;
using System.Text.Json;

namespace OrgNotes.Server;

/// <summary>
/// Notifies each user of today's timed agenda items and sends a daily summary, without the web page open:
/// natively on this machine (notify-send / Windows toast) and/or through the user's ntfy topic.
/// </summary>
public class Notifier(Users users, IConfiguration config, IHttpClientFactory http, ILogger<Notifier> log) : BackgroundService
{
    private readonly HashSet<string> _sent = [];
    private DateOnly _day;

    private IConfigurationSection Section => config.GetSection("Notifications");
    private int[] DeadlineDays => (Section["DeadlineReminders"] ?? "7,3,1,0").Split(',', StringSplitOptions.TrimEntries)
        .Select(d => int.TryParse(d, out var n) ? n : -1).Where(n => n >= 0).ToArray();
    public string NtfyServer => (Section["NtfyServer"] ?? "https://ntfy.sh").TrimEnd('/');

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        if (!Section.GetValue("Enabled", true)) return;
        var lead = TimeSpan.FromMinutes(Section.GetValue("MinutesBefore", 10));
        var summaryAt = TimeOnly.Parse(Section["DailySummaryAt"] ?? "08:00");
        // On by default when only one person uses the server, i.e. it runs on their own machine.
        var native = Section.GetValue("Native", users.All().Count() <= 1);

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            var now = DateTime.Now;
            if (DateOnly.FromDateTime(now) != _day)
            {
                _day = DateOnly.FromDateTime(now);
                _sent.Clear();
            }
            foreach (var key in users.All())
            {
                try { await Tick(key, now, lead, summaryAt, native, stop); }
                catch (Exception e) { log.LogError(e, "Agenda notification check failed for {User}", key); }
            }
        } while (await timer.WaitForNextTickAsync(stop));
    }

    private async Task Tick(string key, DateTime now, TimeSpan lead, TimeOnly summaryAt, bool native, CancellationToken stop)
    {
        var settings = users.Settings(key);
        if (!native && !settings.Notify) return;
        var lang = Strings.IsLang(settings.Lang) ? settings.Lang! : "pt";
        string T(string pt, params object[] args) => Strings.Tr(lang, pt, args);
        async Task Send(string title, string body)
        {
            if (native) ShowNative(title, body);
            if (settings.Notify) await Ntfy(settings.NtfyTopic, title, body, stop);
        }

        var today = DateOnly.FromDateTime(now);
        var store = users.Store(key);
        var items = store.List()
            .SelectMany(f => store.Read(f.Path) is { } text ? OrgAgenda.Today(text, today) : [])
            .ToList();

        foreach (var it in items.Where(i => i.Time != null && i.Kind is "scheduled" or "deadline" or "timestamp"))
        {
            var at = today.ToDateTime(it.Time!.Value);
            if (now < at - lead || now >= at + TimeSpan.FromMinutes(1) || !_sent.Add($"{key}|{it.Kind}|{it.Time}|{it.Title}")) continue;
            var mins = (int)Math.Ceiling((at - now).TotalMinutes);
            var when = mins > 0 ? T("em {0} min", mins) : T("agora");
            await Send($"{T(it.Kind == "deadline" ? "Prazo" : "Agenda")} {it.Time:HH\\:mm} · {when}", it.Title);
        }

        if (settings.SummarySent != today && TimeOnly.FromDateTime(now) >= summaryAt)
        {
            users.Save(key, users.Settings(key) with { SummarySent = today });
            if (Summary(items, lang) is { } body) await Send(T("Agenda de hoje"), body);

            // A reminder of its own for each deadline that is N days away (by default 7, 3, 1 and 0 days).
            foreach (var it in items.Where(i => i.Kind is "deadline" or "upcoming"))
            {
                var days = it.Kind == "deadline" ? 0 : it.Days;
                if (!DeadlineDays.Contains(days)) continue;
                // A deadline less than an hour away already gets (or got) its "in N min" reminder.
                if (days == 0 && it.Time is { } at && today.ToDateTime(at) - now < TimeSpan.FromHours(1)) continue;
                var when = days switch { 0 => T("Prazo hoje"), 1 => T("Prazo amanhã"), _ => T("Prazo em {0} dias", days) };
                await Send(it.Time is { } t ? T("{0} às {1}", when, t.ToString("HH\\:mm")) : when, it.Title);
            }
        }
    }

    private static string? Summary(List<AgendaItem> items, string lang)
    {
        if (items.Count == 0) return null;
        string T(string pt, params object[] args) => Strings.Tr(lang, pt, args);
        var lines = items
            .OrderBy(i => i.Kind is "overdue" or "sched-past" or "upcoming").ThenBy(i => i.Time ?? TimeOnly.MaxValue)
            .Select(i => i.Kind switch
            {
                "overdue" => T("⚠ Prazo há {0} d: {1}", i.Days, i.Title),
                "sched-past" => T("Agendado há {0} d: {1}", i.Days, i.Title),
                "upcoming" => T("Prazo em {0} d: {1}", i.Days, i.Title),
                "deadline" => T("{0} Prazo: {1}", i.Time?.ToString("HH\\:mm") ?? "", i.Title).TrimStart(),
                _ => $"{i.Time:HH\\:mm} {i.Title}".TrimStart(),
            })
            .ToList();
        return string.Join('\n', lines.Take(8)) + (lines.Count > 8 ? "\n" + T("… e mais {0}", lines.Count - 8) : "");
    }

    private async Task Ntfy(string topic, string title, string body, CancellationToken stop)
    {
        log.LogInformation("ntfy {Topic}: {Title}", topic, title);
        // JSON publishing keeps non-ASCII titles intact (HTTP headers would not).
        var res = await http.CreateClient().PostAsync(NtfyServer, new StringContent(JsonSerializer.Serialize(new { topic, title, message = body }), Encoding.UTF8, "application/json"), stop);
        if (!res.IsSuccessStatusCode) log.LogWarning("ntfy returned {Status}", (int)res.StatusCode);
    }

    private void ShowNative(string title, string body)
    {
        log.LogInformation("Notify: {Title} — {Body}", title, body.ReplaceLineEndings(" / "));
        var psi = OperatingSystem.IsWindows() ? WindowsToast(title, body) : new ProcessStartInfo("notify-send") { ArgumentList = { "-a", "Org Notes", title, body } };
        try { Process.Start(psi)?.Dispose(); }
        catch (Exception e) { log.LogWarning("Could not show notification via {Cmd}: {Error}", psi.FileName, e.Message); }
    }

    /// <summary>Toast through Windows PowerShell's WinRT bindings, so no Windows-only package is needed.</summary>
    private static ProcessStartInfo WindowsToast(string title, string body)
    {
        static string Text(string s) => SecurityElement.Escape(s).Replace("'", "''");
        var script = $$"""
            [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
            [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
            $x = New-Object Windows.Data.Xml.Dom.XmlDocument
            $x.LoadXml('<toast><visual><binding template="ToastGeneric"><text>{{Text(title)}}</text><text>{{Text(body)}}</text></binding></visual></toast>')
            [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))
            """;
        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        return new ProcessStartInfo("powershell.exe") { ArgumentList = { "-NoProfile", "-WindowStyle", "Hidden", "-EncodedCommand", encoded }, CreateNoWindow = true };
    }
}
