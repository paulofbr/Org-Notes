using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace OrgNotes.Server;

/// <summary>
/// A reminder to show between <see cref="From"/> and <see cref="Until"/> (the user's wall-clock time). <see cref="View"/>
/// names what it is about, for the site to list it (`/?view=` plus it, escaped): its entry (`path=…&amp;line=…&amp;title=…`,
/// and `&amp;id=…` with an `:ID:`) or, for the daily summary, the day (`list=yyyy-MM-dd`).
/// </summary>
public record Reminder(string Id, DateTime From, DateTime Until, string Title, string Body, string? View = null);

/// <summary>
/// Works out each user's reminders for the day: before each timed agenda item (by default 10 min, or as its
/// `:REMINDER:` says), a morning summary and a reminder for each deadline N days away. A timed reminder stays due for
/// an hour, so a device that was asleep still shows it, as late. The server sends them through the user's ntfy topic,
/// even with every device off; the capture app and the site read them from /api/reminders.
/// </summary>
public class Notifier(Users users, IConfiguration config, IHttpClientFactory http, ILogger<Notifier> log) : BackgroundService
{
    // Sent timed reminders (user|id), until they are no longer due (UTC).
    private readonly ConcurrentDictionary<string, DateTime> _sent = new();
    // Snoozed from the phone: sent again at the time given (UTC).
    private readonly ConcurrentDictionary<string, (string Key, Reminder Reminder, DateTime At)> _snoozed = new();
    private static readonly TimeSpan Late = TimeSpan.FromHours(1);

    private IConfigurationSection Section => config.GetSection("Notifications");
    private bool Enabled => Section.GetValue("Enabled", true);
    private TimeSpan Lead => TimeSpan.FromMinutes(Section.GetValue("MinutesBefore", 10));
    private TimeOnly SummaryAt => TimeOnly.Parse(Section["DailySummaryAt"] ?? "08:00");
    // The summary is a morning one: an entry added in the evening does not bring it up then.
    private TimeOnly SummaryUntil => TimeOnly.Parse(Section["DailySummaryUntil"] ?? "12:00");
    private int[] DeadlineDays => (Section["DeadlineReminders"] ?? "7,3,1,0").Split(',', StringSplitOptions.TrimEntries)
        .Select(d => int.TryParse(d, out var n) ? n : -1).Where(n => n >= 0).ToArray();
    public string NtfyServer => (Section["NtfyServer"] ?? "https://ntfy.sh").TrimEnd('/');
    // The site's public address (set by the installer from its domain), for the phone to open the reminder's entry.
    private string? PublicUrl => config["PublicUrl"]?.TrimEnd('/') is { Length: > 0 } u ? u : null;

    /// <summary>The user's wall-clock time, in their time zone (the server's when they have none).</summary>
    public DateTime Now(string key) =>
        users.Settings(key).TimeZone is { } tz && TimeZoneInfo.TryFindSystemTimeZoneById(tz, out var zone)
            ? TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone) : DateTime.Now;

    /// <summary>The user's reminders for the day of <paramref name="now"/> (and those of the next days that start today), in their language.</summary>
    public List<Reminder> Reminders(string key, DateTime now)
    {
        if (!Enabled) return [];
        var lang = users.Settings(key).Lang is { } l && Strings.IsLang(l) ? l : "pt";
        string T(string pt, params object[] args) => Strings.Tr(lang, pt, args);
        var today = DateOnly.FromDateTime(now);
        var store = users.Store(key);
        var texts = store.List().Select(f => (f.Path, Text: store.Read(f.Path))).Where(f => f.Text != null).ToList();
        List<(string Path, AgendaItem Item)> On(DateOnly day) => texts.SelectMany(f => OrgAgenda.Today(f.Text!, day).Select(i => (f.Path, i))).ToList();
        static string View(string path, AgendaItem it) =>
            $"path={Uri.EscapeDataString(path)}&line={it.Line}&title={Uri.EscapeDataString(it.Title)}{(it.Id is { } id ? $"&id={Uri.EscapeDataString(id)}" : "")}";
        var found = On(today);
        var items = found.Select(x => x.Item).ToList();
        var reminders = new List<Reminder>();
        var startOfDay = today.ToDateTime(TimeOnly.MinValue);
        var endOfDay = startOfDay.AddDays(1);

        // Today's items, and the next days' whose reminder (up to 7 days before) starts today. Yesterday's too, whose
        // late hour runs into today. The id carries the date, so a reminder is not shown again when the day changes.
        var timed = Enumerable.Range(-1, 9).SelectMany(d => (d == 0 ? found : On(today.AddDays(d))).Select(x => (Day: today.AddDays(d), x.Path, x.Item)));
        foreach (var (day, path, it) in timed.Where(x => x.Item.Time != null && x.Item.Kind is "scheduled" or "deadline" or "timestamp"))
        {
            var at = day.ToDateTime(it.Time!.Value);
            foreach (var lead in it.Leads ?? [Lead])
            {
                var (from, until) = (at - lead, at - lead + Late);
                if (from >= endOfDay || until <= startOfDay) continue;
                // The usual 10 min keep the id they always had; other leads have their own.
                var id = $"{it.Kind}|{day:yyyy-MM-dd}|{it.Time:HH\\:mm}|{it.Title}{(lead == Lead ? "" : $"|{lead.TotalMinutes}m")}";
                reminders.Add(new(id, from, until, $"{T(it.Kind == "deadline" ? "Prazo" : "Agenda")} {it.Time:HH\\:mm} · {When(at, from, now, T)}", it.Title, View(path, it)));
            }
        }

        var summaryAt = today.ToDateTime(SummaryAt);
        var summaryUntil = SummaryUntil > SummaryAt ? today.ToDateTime(SummaryUntil) : endOfDay;
        if (Summary(items, lang) is { } body) reminders.Add(new("summary", summaryAt, summaryUntil, T("Agenda de hoje"), body, $"list={today:yyyy-MM-dd}"));
        // A reminder of its own for each deadline that is N days away (by default 7, 3, 1 and 0 days).
        foreach (var (path, it) in found.Where(x => x.Item.Kind is "deadline" or "upcoming"))
        {
            var days = it.Kind == "deadline" ? 0 : it.Days;
            if (!DeadlineDays.Contains(days)) continue;
            // Once a deadline today is less than an hour away, its "in N min" reminder takes over.
            var until = days == 0 && it.Time is { } at ? today.ToDateTime(at) - TimeSpan.FromHours(1) : endOfDay;
            var when = days switch { 0 => T("Prazo hoje"), 1 => T("Prazo amanhã"), _ => T("Prazo em {0} dias", days) };
            reminders.Add(new($"deadline|{days}|{it.Title}", summaryAt, until,
                it.Time is { } t ? T("{0} às {1}", when, t.ToString("HH\\:mm")) : when, it.Title, View(path, it)));
        }
        return reminders;
    }

    /// <summary>"in 10 min", "in 3 h", "tomorrow", "in 2 days"; "now"; or, shown late, "5 min ago".</summary>
    private static string When(DateTime at, DateTime from, DateTime now, Func<string, object[], string> T)
    {
        var left = at - (now < from ? from : now);
        if (left > TimeSpan.Zero)
        {
            var days = DateOnly.FromDateTime(at).DayNumber - DateOnly.FromDateTime(now < from ? from : now).DayNumber;
            return left.TotalMinutes < 60 ? T("em {0} min", [(int)Math.Ceiling(left.TotalMinutes)])
                : days == 0 ? T("em {0} h", [(int)Math.Round(left.TotalHours)])
                : days == 1 ? T("amanhã", []) : T("em {0} dias", [days]);
        }
        var ago = (int)Math.Floor(-left.TotalMinutes);
        return ago < 1 ? T("agora", []) : T("há {0} min", [ago]);
    }

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        if (!Enabled) return;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            foreach (var (id, until) in _sent)
                if (until < DateTime.UtcNow) _sent.TryRemove(id, out _);
            foreach (var key in users.All())
            {
                try { await Tick(key, stop); }
                catch (Exception e) { log.LogError(e, "Agenda notification check failed for {User}", key); }
            }
            foreach (var (id, (key, r, at)) in _snoozed)
                if (at <= DateTime.UtcNow && _snoozed.TryRemove(id, out _) && users.Settings(key) is { Notify: true } s)
                    await Ntfy(key, s, r, stop);
        } while (await timer.WaitForNextTickAsync(stop));
    }

    private async Task Tick(string key, CancellationToken stop)
    {
        var settings = users.Settings(key);
        if (!settings.Notify) return;
        var now = Now(key);
        var today = DateOnly.FromDateTime(now);
        var due = Reminders(key, now).Where(r => r.From <= now && now < r.Until).ToList();
        // The morning reminders are remembered on disk, so a restart does not send them again.
        var daily = due.Where(IsDaily).ToList();
        if (daily.Count > 0 && settings.SummarySent != today)
        {
            users.Save(key, users.Settings(key) with { SummarySent = today });
            foreach (var r in daily) await Ntfy(key, settings, r, stop);
        }
        foreach (var r in due.Except(daily).Where(r => _sent.TryAdd($"{key}|{r.Id}", DateTime.UtcNow + (r.Until - now))))
            await Ntfy(key, settings, r, stop);
    }

    /// <summary>The morning ones: the summary and the deadline reminders.</summary>
    public static bool IsDaily(Reminder r) => r.Id == "summary" || r.Id.StartsWith("deadline|");

    /// <summary>Sends a sample reminder to the user's phone, to check it arrives (and its buttons work).</summary>
    public Task Test(string key, CancellationToken stop)
    {
        var settings = users.Settings(key);
        var lang = settings.Lang is { } l && Strings.IsLang(l) ? l : "pt";
        var now = Now(key);
        return Ntfy(key, settings, new($"test|{now:O}", now, now, Strings.Tr(lang, "Teste de lembrete"), Strings.Tr(lang, "Assim vais ver os lembretes da agenda."), $"list={now:yyyy-MM-dd}"), stop);
    }

    /// <summary>
    /// "Adiar 15 min" on the phone: the reminder comes back then. <paramref name="sig"/> proves the link came from one
    /// of the user's notifications (the phone calls it without signing in).
    /// </summary>
    public bool Snooze(string user, string id, string sig)
    {
        if (users.All().FirstOrDefault(k => Handle(k) == user) is not { } key
            || !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Sign(key, id)), Encoding.ASCII.GetBytes(sig))) return false;
        if (Reminders(key, Now(key)).FirstOrDefault(r => r.Id == id) is not { } r) return false;
        _snoozed[$"{key}|{id}"] = (key, r, DateTime.UtcNow.AddMinutes(15));
        return true;
    }

    // Names the user in the phone's "Adiar" link without their email (which would pass through the ntfy server).
    private static string Handle(string key) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(key)))[..16];

    private string Sign(string key, string id)
    {
        var settings = users.Settings(key);
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(settings.ApiToken ?? settings.NtfyTopic));
        return Convert.ToHexStringLower(hmac.ComputeHash(Encoding.UTF8.GetBytes(id)));
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

    private async Task Ntfy(string key, UserSettings settings, Reminder r, CancellationToken stop)
    {
        log.LogInformation("ntfy {Topic}: {Title}", settings.NtfyTopic, r.Title);
        var lang = settings.Lang is { } l && Strings.IsLang(l) ? l : "pt";
        // Tapping it, or "Ver", opens what it is about; "Adiar 15 min" brings it back later (not for a test).
        var click = PublicUrl is { } site && r.View is { } view ? $"{site}/?view={Uri.EscapeDataString(view)}" : null;
        var actions = new List<object>();
        if (click != null) actions.Add(new { action = "view", label = Strings.Tr(lang, "Ver"), url = click });
        if (PublicUrl is { } s && !r.Id.StartsWith("test|"))
            actions.Add(new { action = "http", label = Strings.Tr(lang, "Adiar 15 min"), method = "POST", clear = true,
                url = $"{s}/api/ntfy/snooze?u={Handle(key)}&id={Uri.EscapeDataString(r.Id)}&sig={Sign(key, r.Id)}" });
        // JSON publishing keeps non-ASCII titles intact (HTTP headers would not). High priority (4) makes the phone
        // vibrate and ring, so the reminder is not missed; the tag shows as an alarm clock.
        var json = JsonSerializer.Serialize(new { topic = settings.NtfyTopic, title = r.Title, message = r.Body, priority = 4, tags = new[] { "alarm_clock" }, click, actions = actions.Count > 0 ? actions : null },
            new JsonSerializerOptions { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull });
        var res = await http.CreateClient().PostAsync(NtfyServer, new StringContent(json, Encoding.UTF8, "application/json"), stop);
        if (!res.IsSuccessStatusCode) log.LogWarning("ntfy returned {Status}", (int)res.StatusCode);
    }
}
