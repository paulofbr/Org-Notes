using System.Text.RegularExpressions;

namespace OrgNotes.Server;

/// <summary>An agenda item; <see cref="Line"/> is its headline's line in the file.</summary>
public record AgendaItem(string Title, string Kind, DateOnly Date, TimeOnly? Time, int Days, int Line);

/// <summary>
/// Minimal port of the client's org parsing and agenda rules (client/src/org), enough to know what is due today.
/// Kinds: scheduled, deadline, timestamp, overdue, sched-past, upcoming — same as the client's agenda.
/// </summary>
public static partial class OrgAgenda
{
    private const string Single = @"([<[])(\d{4}-\d{2}-\d{2})(?: +[^\s\d>\]+.-][^\s>\]]*)?(?: +(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?)?((?: +(?:\+\+|\.\+|\+|--?)\d+[hdwmy])*) *[>\]]";

    [GeneratedRegex(Single + "(?:--" + Single + ")?")] private static partial Regex TimestampRe();
    [GeneratedRegex(@"^(\*+)(?:[ \t]+(.*))?$")] private static partial Regex HeadlineRe();
    [GeneratedRegex(@"^\s*(?:SCHEDULED|DEADLINE|CLOSED):")] private static partial Regex PlanningRe();
    [GeneratedRegex(@"(SCHEDULED|DEADLINE|CLOSED):\s*([<[][^>\]]+[>\]](?:--[<[][^>\]]+[>\]])?)")] private static partial Regex PlanningItemRe();
    [GeneratedRegex(@"(?:^|[ \t]+)(:(?:[\w@#%]+:)+)[ \t]*$")] private static partial Regex TagsRe();
    [GeneratedRegex(@"^\s*#\+(?:SEQ_|TYP_)?TODO:\s*(.*)$", RegexOptions.IgnoreCase)] private static partial Regex TodoSpecRe();
    [GeneratedRegex(@"\[\[([^\]]+)\](?:\[([^\]]+)\])?\]")] private static partial Regex LinkRe();

    private record Ts(DateOnly Date, TimeOnly? Time, char? RepUnit, int RepN, int WarnDays, DateOnly? End);

    public static List<AgendaItem> Today(string text, DateOnly today)
    {
        var lines = text.Split('\n').Select(l => l.TrimEnd('\r')).ToArray();
        var (todo, done) = TodoKeywords(lines);
        var heads = Enumerable.Range(0, lines.Length).Where(i => HeadlineRe().IsMatch(lines[i])).ToList();
        var items = new List<AgendaItem>();

        for (var n = 0; n < heads.Count; n++)
        {
            int line = heads[n], end = n + 1 < heads.Count ? heads[n + 1] : lines.Length;
            var rest = HeadlineRe().Match(lines[line]).Groups[2].Value;
            if (TagsRe().Match(rest) is { Success: true } t) rest = rest[..t.Index];
            var first = rest.Split(' ', 2, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
            var isDone = first != null && done.Contains(first);
            if (isDone) continue; // finished entries need no reminders
            if (first != null && todo.Contains(first)) rest = rest.TrimStart()[first.Length..];
            rest = Regex.Replace(rest.Trim(), @"^\[#[A-Z0-9]\]\s*", "");
            var title = LinkRe().Replace(TimestampRe().Replace(rest, ""), m => m.Groups[2].Success ? m.Groups[2].Value : m.Groups[1].Value).Trim();
            void Add(string kind, Ts ts, DateOnly date, int days = 0) => items.Add(new(title, kind, date, ts.Time, days, line));

            var body = line + 1;
            if (body < end && PlanningRe().IsMatch(lines[body]))
            {
                foreach (Match m in PlanningItemRe().Matches(lines[body]))
                {
                    if (Parse(m.Groups[2].Value) is not { } ts || m.Groups[1].Value == "CLOSED") continue;
                    var scheduled = m.Groups[1].Value == "SCHEDULED";
                    if (Occurs(ts, today))
                    {
                        Add(scheduled ? "scheduled" : "deadline", ts, today);
                        continue;
                    }
                    var diff = today.DayNumber - ts.Date.DayNumber;
                    if (scheduled && diff > 0) Add("sched-past", ts, today, diff);
                    if (!scheduled && diff > 0) Add("overdue", ts, today, diff);
                    if (!scheduled && diff < 0 && -diff <= ts.WarnDays) Add("upcoming", ts, ts.Date, -diff);
                }
                body++;
            }
            foreach (var l in lines[body..end].Prepend(rest))
                foreach (Match m in TimestampRe().Matches(l))
                    if (m.Value[0] == '<' && Parse(m.Value) is { } ts && Occurs(ts, today)) Add("timestamp", ts, today);
        }
        return items;
    }

    /// <summary>
    /// Every headline's title as an org link targets it (`*Title`): without its state, priority and tags, like the
    /// client parser's title.
    /// </summary>
    public static List<string> Titles(string text)
    {
        var lines = text.Split('\n').Select(l => l.TrimEnd('\r')).ToArray();
        var (todo, done) = TodoKeywords(lines);
        var titles = new List<string>();
        foreach (var l in lines)
        {
            if (HeadlineRe().Match(l) is not { Success: true } m) continue;
            var rest = m.Groups[2].Value;
            if (TagsRe().Match(rest) is { Success: true } t) rest = rest[..t.Index];
            var first = rest.Split(' ', 2, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
            if (first != null && (todo.Contains(first) || done.Contains(first))) rest = rest.TrimStart()[first.Length..];
            var title = Regex.Replace(rest.Trim(), @"^\[#[A-Z0-9]\]\s*", "").Trim();
            if (title != "") titles.Add(title);
        }
        return titles;
    }

    private static (HashSet<string> Todo, HashSet<string> Done) TodoKeywords(string[] lines)
    {
        var specs = lines.Select(l => TodoSpecRe().Match(l)).Where(m => m.Success).Select(m => m.Groups[1].Value).ToList();
        if (specs.Count == 0) return (["TODO"], ["DONE"]);
        HashSet<string> todo = [], done = [];
        foreach (var s in specs)
        {
            var words = s.Split(' ', '\t').Where(w => w != "").Select(w => Regex.Replace(w, @"\(.*\)$", "")).ToList();
            var bar = words.IndexOf("|");
            todo.UnionWith(bar >= 0 ? words[..bar] : words[..^1]);
            done.UnionWith(bar >= 0 ? words[(bar + 1)..] : words[^1..]);
        }
        return (todo, done);
    }

    private static Ts? Parse(string raw)
    {
        var m = TimestampRe().Match(raw);
        if (!m.Success) return null;
        var g = m.Groups;
        TimeOnly? time = g[3].Success ? TimeOnly.Parse(g[3].Value) : null;
        char? unit = null;
        int repN = 0, warn = 14;
        foreach (var mod in g[5].Value.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var r = Regex.Match(mod, @"^(?:\+\+|\.\+|\+)(\d+)([hdwmy])$");
            if (r.Success) (repN, unit) = (int.Parse(r.Groups[1].Value), r.Groups[2].Value[0]);
            var w = Regex.Match(mod, @"^--?(\d+)([hdwmy])$");
            if (w.Success)
            {
                var k = int.Parse(w.Groups[1].Value);
                warn = w.Groups[2].Value switch { "w" => k * 7, "m" => k * 30, "y" => k * 365, "h" => 0, _ => k };
            }
        }
        DateOnly? end = g[7].Success ? DateOnly.Parse(g[7].Value) : null;
        return new(DateOnly.Parse(g[2].Value), time, unit, repN, warn, end);
    }

    /// <summary>Whether a (possibly repeating or ranged) timestamp falls on the given day.</summary>
    private static bool Occurs(Ts ts, DateOnly day)
    {
        if (ts.End is { } end) return day >= ts.Date && day <= end;
        if (ts.RepUnit is not { } u || u == 'h' || ts.RepN <= 0) return ts.Date == day;
        for (var i = 0; i < 2000; i++)
        {
            var d = ts.Date;
            var k = i * ts.RepN;
            d = u switch { 'd' => d.AddDays(k), 'w' => d.AddDays(7 * k), 'm' => d.AddMonths(k), _ => d.AddYears(k) };
            if (d == day) return true;
            if (d > day) return false;
        }
        return false;
    }
}
