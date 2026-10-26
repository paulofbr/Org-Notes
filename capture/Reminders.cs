using System.Diagnostics;
using System.Security;
using System.Text;
using System.Text.Json;

namespace OrgNotes.Capture;

/// <summary>
/// Shows the user's agenda reminders on this machine, each once when it is due: as a notification that stays on screen
/// with a sound (notify-send / Windows reminder toast) and through <paramref name="onDue"/> (the reminder window).
/// The server works them out from the notes; this only asks for them through the API.
/// </summary>
public class Reminders(Config config, Action<string, string> onDue)
{
    private record Shown(DateOnly Date, HashSet<string> Ids);

    private static string ShownPath => Path.Combine(Config.Dir, "shown.json");

    public async Task Run()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            if (!config.Reminders || !Config.Exists || config.Token == "") continue;
            try { await Check(DateTime.Now); }
            // The server may be unreachable for a while (offline, asleep): try again on the next tick.
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException or IOException) { }
        } while (await timer.WaitForNextTickAsync());
    }

    private async Task Check(DateTime now)
    {
        var today = DateOnly.FromDateTime(now);
        var shown = Load() is { } s && s.Date == today ? s : new Shown(today, []);
        var due = (await new Api(config).Reminders(now)).Where(r => r.From <= now && now < r.Until && !shown.Ids.Contains(r.Id)).ToList();
        if (due.Count == 0) return;
        foreach (var r in due)
        {
            Show(r.Title, r.Body, alert: true);
            onDue(r.Title, r.Body);
            shown.Ids.Add(r.Id);
        }
        Directory.CreateDirectory(Config.Dir);
        await File.WriteAllTextAsync(ShownPath, JsonSerializer.Serialize(shown));
    }

    private static Shown? Load()
    {
        try { return File.Exists(ShownPath) ? JsonSerializer.Deserialize<Shown>(File.ReadAllText(ShownPath)) : null; }
        catch (JsonException) { return null; }
    }

    /// <summary>
    /// Shows a native notification: an <paramref name="alert"/> (a reminder) stays until dismissed and plays a sound;
    /// otherwise (e.g. the answer to an update check) it is a plain one.
    /// </summary>
    public static void Show(string title, string body, bool alert = false)
    {
        var psi = OperatingSystem.IsWindows() ? WindowsToast(title, body, alert)
            : new ProcessStartInfo("notify-send") { ArgumentList = { "-a", "Org Notes", "-u", alert ? "critical" : "normal", title, body } };
        try { Process.Start(psi)?.Dispose(); }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException) { /* no notifier installed */ }
    }

    private const string PlainToast = """<toast><visual><binding template="ToastGeneric"><text>{title}</text><text>{body}</text></binding></visual></toast>""";

    // The reminder scenario keeps the toast on screen until acted on; the system actions (empty labels get the
    // system's own words) snooze it for the chosen time or dismiss it.
    private const string ReminderToast = """<toast scenario="reminder"><visual><binding template="ToastGeneric"><text>{title}</text><text>{body}</text></binding></visual><actions><input id="snooze" type="selection" defaultInput="5"><selection id="5" content="5 min"/><selection id="15" content="15 min"/><selection id="60" content="1 h"/></input><action activationType="system" arguments="snooze" hint-inputId="snooze" content=""/><action activationType="system" arguments="dismiss" content=""/></actions><audio src="ms-winsoundevent:Notification.Reminder"/></toast>""";

    /// <summary>Toast through Windows PowerShell's WinRT bindings, so no Windows-only package is needed.</summary>
    private static ProcessStartInfo WindowsToast(string title, string body, bool alert)
    {
        static string Text(string s) => SecurityElement.Escape(s).Replace("'", "''");
        var script = $$"""
            [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
            [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
            $x = New-Object Windows.Data.Xml.Dom.XmlDocument
            $x.LoadXml('{{(alert ? ReminderToast : PlainToast).Replace("{title}", Text(title)).Replace("{body}", Text(body))}}')
            [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))
            """;
        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        return new ProcessStartInfo("powershell.exe") { ArgumentList = { "-NoProfile", "-WindowStyle", "Hidden", "-EncodedCommand", encoded }, CreateNoWindow = true };
    }
}
