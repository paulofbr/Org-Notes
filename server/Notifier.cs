using System.Text;
using System.Text.Json;

namespace OrgNotes.Server;

/// <summary>A reminder to show between <see cref="From"/> and <see cref="Until"/> (the user's wall-clock time).</summary>
public record Reminder(string Id, DateTime From, DateTime Until, string Title, string Body);

/// <summary>
/// Works out each user's reminders for the day: before each timed agenda item, a daily summary and a reminder for
/// each deadline N days away. The server sends them through the user's ntfy topic, even with every device off;
/// the capture app reads them from /api/reminders to show them natively on the user's own machine.
/// </summary>
public class Notifier(Users users, IConfiguration config, IHttpClientFactory http, ILogger<Notifier> log) : BackgroundService
{
    private readonly HashSet<string> _sent = [];
    private DateOnly _day;

    private IConfigurationSection Section => config.GetSection("Notifications");
    private bool Enabled => Section.GetValue("Enabled", true);
    private TimeSpan Lead => TimeSpan.FromMinutes(Section.GetValue("MinutesBefore", 10));
    private TimeOnly SummaryAt => TimeOnly.Parse(Section["DailySummaryAt"] ?? "08:00");
    private int[] DeadlineDays => (Section["DeadlineReminders"] ?? "7,3,1,0").Split(',', StringSplitOptions.TrimEntries)
        .Select(d => int.TryParse(d, out var n) ? n : -1).Where(n => n >= 0).ToArray();
    public string NtfyServer => (Section["NtfyServer"] ?? "https://ntfy.sh").TrimEnd('/');

    /// <summary>The user's reminders for the day of <paramref name="now"/>, in their language.</summary>
    public List<Reminder> Reminders(string key, DateTime now)
    {
        if (!Enabled) return [];
        var lang = users.Settings(key).Lang is { } l && Strings.IsLang(l) ? l : "pt";
        string T(string pt, params object[] args) => Strings.Tr(lang, pt, args);
        var today = DateOnly.FromDateTime(now);
        var store = users.Store(key);
        var items = store.List()
            .SelectMany(f => store.Read(f.Path) is { } text ? OrgAgenda.Today(text, today) : [])
            .ToList();
        var reminders = new List<Reminder>();

        foreach (var it in items.Where(i => i.Time != null && i.Kind is "scheduled" or "deadline" or "timestamp"))
        {
            var at = today.ToDateTime(it.Time!.Value);
            var minutes = (int)Math.Ceiling((now < at - Lead ? Lead : at - now).TotalMinutes);
            var when = minutes > 0 ? T("em {0} min", minutes) : T("agora");
            reminders.Add(new($"{it.Kind}|{it.Time:HH\\:mm}|{it.Title}", at - Lead, at + TimeSpan.FromMinutes(1),
                $"{T(it.Kind == "deadline" ? "Prazo" : "Agenda")} {it.Time:HH\\:mm} · {when}", it.Title));
        }

        var summaryAt = today.ToDateTime(SummaryAt);
        var endOfDay = today.ToDateTime(TimeOnly.MinValue).AddDays(1);
        if (Summary(items, lang) is { } body) reminders.Add(new("summary", summaryAt, endOfDay, T("Agenda de hoje"), body));
        // A reminder of its own for each deadline that is N days away (by default 7, 3, 1 and 0 days).
        foreach (var it in items.Where(i => i.Kind is "deadline" or "upcoming"))
        {
            var days = it.Kind == "deadline" ? 0 : it.Days;
            if (!DeadlineDays.Contains(days)) continue;
            // Once a deadline today is less than an hour away, its "in N min" reminder takes over.
            var until = days == 0 && it.Time is { } at ? today.ToDateTime(at) - TimeSpan.FromHours(1) : endOfDay;
            var when = days switch { 0 => T("Prazo hoje"), 1 => T("Prazo amanhã"), _ => T("Prazo em {0} dias", days) };
            reminders.Add(new($"deadline|{days}|{it.Title}", summaryAt, until,
                it.Time is { } t ? T("{0} às {1}", when, t.ToString("HH\\:mm")) : when, it.Title));
        }
        return reminders;
    }

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        if (!Enabled) return;
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
                try { await Tick(key, now, stop); }
                catch (Exception e) { log.LogError(e, "Agenda notification check failed for {User}", key); }
            }
        } while (await timer.WaitForNextTickAsync(stop));
    }

    private async Task Tick(string key, DateTime now, CancellationToken stop)
    {
        var settings = users.Settings(key);
        if (!settings.Notify) return;
        var today = DateOnly.FromDateTime(now);
        var due = Reminders(key, now).Where(r => r.From <= now && now < r.Until).ToList();
        // The morning reminders are remembered on disk, so a restart does not send them again.
        var daily = due.Where(IsDaily).ToList();
        if (daily.Count > 0 && settings.SummarySent != today)
        {
            users.Save(key, users.Settings(key) with { SummarySent = today });
            foreach (var r in daily) await Ntfy(settings.NtfyTopic, r.Title, r.Body, stop);
        }
        foreach (var r in due.Except(daily).Where(r => _sent.Add($"{key}|{r.Id}")))
            await Ntfy(settings.NtfyTopic, r.Title, r.Body, stop);
    }

    /// <summary>The morning ones: the summary and the deadline reminders.</summary>
    public static bool IsDaily(Reminder r) => r.Id == "summary" || r.Id.StartsWith("deadline|");

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
        // JSON publishing keeps non-ASCII titles intact (HTTP headers would not). High priority (4) makes the phone
        // vibrate and ring, so the reminder is not missed; the tag shows as an alarm clock.
        var json = JsonSerializer.Serialize(new { topic, title, message = body, priority = 4, tags = new[] { "alarm_clock" } });
        var res = await http.CreateClient().PostAsync(NtfyServer, new StringContent(json, Encoding.UTF8, "application/json"), stop);
        if (!res.IsSuccessStatusCode) log.LogWarning("ntfy returned {Status}", (int)res.StatusCode);
    }
}
