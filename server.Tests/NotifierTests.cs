using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using OrgNotes.Server;
using Xunit;

public class OrgAgendaTests
{
    [Fact]
    public void ReadsIdAndReminderProperties()
    {
        var text = "* Reunião\n:PROPERTIES:\n:ID: abc-1\n:REMINDER: 1d 15m 2h\n:END:\n<2026-10-30 Fri 18:00>\n* Outra\n<2026-10-30 Fri 19:00>\n";
        var items = OrgAgenda.Today(text, new DateOnly(2026, 10, 30));
        var first = Assert.Single(items, i => i.Title == "Reunião");
        Assert.Equal("abc-1", first.Id);
        Assert.Equal([TimeSpan.FromDays(1), TimeSpan.FromMinutes(15), TimeSpan.FromHours(2)], first.Leads!);
        var other = Assert.Single(items, i => i.Title == "Outra");
        Assert.Null(other.Leads);
    }
}

public class NotifierTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("orgnotes-tests").FullName;
    private const string Key = "me@example.com";

    private Notifier With(string agenda)
    {
        var dir = Path.Combine(_root, "users", Key);
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "agenda.org"), agenda);
        var seed = Directory.CreateDirectory(Path.Combine(_root, "seed")).FullName;
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build();
        return new Notifier(new Users(_root, seed), config, new NoHttp(), NullLogger<Notifier>.Instance);
    }

    public void Dispose() => Directory.Delete(_root, true);

    private static Reminder Timed(IEnumerable<Reminder> all, string title) => Assert.Single(all, r => r.Body == title && !Notifier.IsDaily(r));

    [Fact]
    public void RemindsTenMinutesBeforeAndStaysDueAnHourAsLate()
    {
        var n = With("* Reunião\n<2026-10-30 Fri 18:00>\n");
        var r = Timed(n.Reminders(Key, new DateTime(2026, 10, 30, 17, 55, 0)), "Reunião");
        Assert.Equal(new DateTime(2026, 10, 30, 17, 50, 0), r.From);
        Assert.Equal(new DateTime(2026, 10, 30, 18, 50, 0), r.Until);
        Assert.Equal("Agenda 18:00 · em 5 min", r.Title);
        Assert.Equal("Agenda 18:00 · há 5 min", Timed(n.Reminders(Key, new DateTime(2026, 10, 30, 18, 5, 0)), "Reunião").Title);
        Assert.StartsWith("path=agenda.org&line=0&title=Reuni", r.View);
    }

    [Fact]
    public void JustAfterMidnightKeepsItsIdAcrossTheDayChange()
    {
        var n = With("* Cedo\n<2026-10-31 Sat 00:05>\n");
        var before = Timed(n.Reminders(Key, new DateTime(2026, 10, 30, 23, 58, 0)), "Cedo");
        var after = Timed(n.Reminders(Key, new DateTime(2026, 10, 31, 0, 1, 0)), "Cedo");
        Assert.Equal(before.Id, after.Id);
        Assert.Equal(new DateTime(2026, 10, 30, 23, 55, 0), before.From);
    }

    [Fact]
    public void ItsOwnLeadsBringRemindersOnEarlierDays()
    {
        var n = With("* Viagem\n:PROPERTIES:\n:REMINDER: 1d 30m\n:END:\n<2026-11-02 Mon 09:00>\n");
        var dayBefore = Timed(n.Reminders(Key, new DateTime(2026, 11, 1, 9, 10, 0)), "Viagem");
        Assert.Equal(new DateTime(2026, 11, 1, 9, 0, 0), dayBefore.From);
        Assert.Equal("Agenda 09:00 · amanhã", dayBefore.Title);
        var onTheDay = n.Reminders(Key, new DateTime(2026, 11, 2, 8, 40, 0)).Where(r => r.Body == "Viagem" && !Notifier.IsDaily(r)).ToList();
        Assert.Contains(onTheDay, r => r.From == new DateTime(2026, 11, 2, 8, 30, 0));
        Assert.DoesNotContain(onTheDay, r => r.From == new DateTime(2026, 11, 2, 8, 50, 0)); // not the default 10 min too
    }

    [Fact]
    public void TheSummaryIsAMorningOneAndListsTheDay()
    {
        var n = With("* Reunião\n<2026-10-30 Fri 18:00>\n");
        var summary = Assert.Single(n.Reminders(Key, new DateTime(2026, 10, 30, 9, 0, 0)), r => r.Id == "summary");
        Assert.Equal(new DateTime(2026, 10, 30, 12, 0, 0), summary.Until);
        Assert.Equal("list=2026-10-30", summary.View);
    }

    [Fact]
    public void AnEntryWithAnIdIsNamedByIt()
    {
        var n = With("* Reunião\n:PROPERTIES:\n:ID: abc-1\n:END:\n<2026-10-30 Fri 18:00>\n");
        Assert.EndsWith("&id=abc-1", Timed(n.Reminders(Key, new DateTime(2026, 10, 30, 17, 55, 0)), "Reunião").View);
    }

    private class NoHttp : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => throw new InvalidOperationException("no HTTP in tests");
    }
}
