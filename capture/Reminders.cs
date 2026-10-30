using System.Diagnostics;
using System.Security;
using System.Text;
using System.Text.Json;

namespace OrgNotes.Capture;

/// <summary>
/// Shows the user's agenda reminders on this machine, each once when it is due: through <paramref name="onDue"/> (the
/// reminder window, which plays the reminder sound) or, with that window turned off, as a notification that stays on
/// screen with a sound (notify-send / Windows reminder toast) — one of the two, not both.
/// The server works them out from the notes; this only asks for them through the API. Clicking the Windows toast
/// opens the reminder's entry on the site.
/// </summary>
public class Reminders(Config config, Action<Reminder> onDue)
{
    // The reminders already shown, each until it is no longer due (so a restart, or the day changing, does not show it again).
    private record Shown(Dictionary<string, DateTime>? Until);

    private static string ShownPath => Path.Combine(Config.Dir, "shown.json");

    public async Task Run()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        string? lastError = null;
        do
        {
            if (!config.Reminders || !Config.Exists || config.Token == "") continue;
            try
            {
                await Check(DateTime.Now);
                lastError = null;
            }
            // The server may be unreachable for a while (offline, asleep): try again on the next tick. The error goes
            // to the log once, not on every tick.
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException or IOException)
            {
                var error = $"{e.GetType().Name}: {e.Message}";
                if (error != lastError) Log.Write($"Reminders: {error}");
                lastError = error;
            }
        } while (await timer.WaitForNextTickAsync());
    }

    private async Task Check(DateTime now)
    {
        var shown = (Load()?.Until ?? []).Where(x => x.Value > now).ToDictionary();
        // A reminder stays due for an hour after its time, so one missed while the computer slept still shows, as late.
        var due = (await new Api(config).Reminders(now)).Where(r => r.From <= now && now < r.Until && !shown.ContainsKey(r.Id)).ToList();
        if (due.Count == 0) return;
        foreach (var r in due)
        {
            Present(r);
            shown[r.Id] = r.Until;
        }
        Directory.CreateDirectory(Config.Dir);
        await File.WriteAllTextAsync(ShownPath, JsonSerializer.Serialize(new Shown(shown)));
    }

    /// <summary>Shows a reminder: in the reminder window, or with that turned off as a notification.</summary>
    public void Present(Reminder r)
    {
        if (config.ReminderWindow) onDue(r);
        else Show(r.Title, r.Body, alert: true, r.View is { } view ? ViewUrl(config, view) : null);
    }

    /// <summary>A sample reminder (Definições → Testar lembrete), to check how they look and sound here.</summary>
    public void Test() =>
        Present(new($"test|{DateTime.Now:O}", DateTime.Now, DateTime.Now, L.Tr("Teste de lembrete"), L.Tr("Assim vais ver os lembretes da agenda."), $"list={DateTime.Now:yyyy-MM-dd}"));

    private static Shown? Load()
    {
        try { return File.Exists(ShownPath) ? JsonSerializer.Deserialize<Shown>(File.ReadAllText(ShownPath)) : null; }
        catch (JsonException) { return null; }
    }

    /// <summary>The site's page showing a reminder's entry.</summary>
    public static string ViewUrl(Config config, string view) => $"{config.Server.TrimEnd('/')}/?view={Uri.EscapeDataString(view)}";

    /// <summary>
    /// Shows a native notification: an <paramref name="alert"/> (a reminder) stays until dismissed and plays a sound;
    /// otherwise (e.g. the answer to an update check) it is a plain one. Clicking a Windows toast opens <paramref name="url"/>.
    /// </summary>
    public static void Show(string title, string body, bool alert = false, string? url = null)
    {
        var psi = OperatingSystem.IsWindows() ? WindowsToast(title, body, alert, url)
            : new ProcessStartInfo("notify-send") { ArgumentList = { "-a", "Org Notes", "-u", alert ? "critical" : "normal", title, body } };
        try { Process.Start(psi)?.Dispose(); }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException) { /* no notifier installed */ }
    }

    private const string PlainToast = """<toast{launch}><visual><binding template="ToastGeneric"><text>{title}</text><text>{body}</text></binding></visual></toast>""";

    // The reminder scenario keeps the toast on screen until acted on; the system actions (empty labels get the
    // system's own words) snooze it for the chosen time or dismiss it.
    private const string ReminderToast = """<toast scenario="reminder"{launch}><visual><binding template="ToastGeneric"><text>{title}</text><text>{body}</text></binding></visual><actions><input id="snooze" type="selection" defaultInput="5"><selection id="5" content="5 min"/><selection id="15" content="15 min"/><selection id="60" content="1 h"/></input><action activationType="system" arguments="snooze" hint-inputId="snooze" content=""/><action activationType="system" arguments="dismiss" content=""/></actions><audio src="ms-winsoundevent:Notification.Reminder"/></toast>""";

    /// <summary>Toast through Windows PowerShell's WinRT bindings, so no Windows-only package is needed.</summary>
    private static ProcessStartInfo WindowsToast(string title, string body, bool alert, string? url)
    {
        static string Text(string s) => SecurityElement.Escape(s).Replace("'", "''");
        var script = $$"""
            [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
            [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
            $x = New-Object Windows.Data.Xml.Dom.XmlDocument
            $x.LoadXml('{{(alert ? ReminderToast : PlainToast).Replace("{launch}", url is null ? "" : $" activationType=\"protocol\" launch=\"{Text(url)}\"").Replace("{title}", Text(title)).Replace("{body}", Text(body))}}')
            [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))
            """;
        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        return new ProcessStartInfo("powershell.exe") { ArgumentList = { "-NoProfile", "-WindowStyle", "Hidden", "-EncodedCommand", encoded }, CreateNoWindow = true };
    }
}
