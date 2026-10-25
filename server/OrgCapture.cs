using System.Globalization;
using System.Text.RegularExpressions;

namespace OrgNotes.Server;

public record CaptureTemplate(string Key, string Name, string File, bool Datetree, string Body)
{
    public bool UsesWhen => Body.Contains("%{when}");

    /// <summary>The empty properties, like `:EMAIL:`, in order, to ask for in the capture.</summary>
    public List<string> Props => Body.Split('\n').Select(l => OrgCapture.EmptyPropRe().Match(l))
        .Where(m => m.Success && m.Groups[2].Value.ToUpperInvariant() is not ("PROPERTIES" or "END")).Select(m => m.Groups[2].Value).ToList();
}

/// <summary>Server-side port of client/src/org/capture.ts, so clients other than the web page can capture.</summary>
public static partial class OrgCapture
{
    [GeneratedRegex(@"^\s*#\+begin_capture\s+(\S)\s*(.*?)\s*$", RegexOptions.IgnoreCase)] private static partial Regex BeginRe();
    [GeneratedRegex(@"^\s*#\+end_capture\s*$", RegexOptions.IgnoreCase)] private static partial Regex EndRe();
    [GeneratedRegex(@"^(\*+)(?:[ \t]+(.*))?$")] private static partial Regex HeadlineRe();
    [GeneratedRegex(@"^(\s*):([^\s:]+):\s*$")] internal static partial Regex EmptyPropRe();

    [GeneratedRegex(@"^\s*#\+property:\s+(\S+)_ALL\s+(.*)$", RegexOptions.IgnoreCase)] private static partial Regex PropertyAllRe();

    private static readonly string[] DayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    public static IEnumerable<CaptureTemplate> TemplatesIn(string file, string text)
    {
        var lines = text.Split('\n');
        for (var i = 0; i < lines.Length && !HeadlineRe().IsMatch(lines[i]); i++)
        {
            var m = BeginRe().Match(lines[i]);
            if (!m.Success) continue;
            var j = i + 1;
            while (j < lines.Length && !EndRe().IsMatch(lines[j])) j++;
            var datetree = Regex.IsMatch(m.Groups[2].Value, @"(^|\s):datetree$");
            var name = Regex.Replace(m.Groups[2].Value, @"\s*:datetree$", "");
            var body = string.Join('\n', lines[(i + 1)..j].Select(l => Regex.Replace(l, @"^(\s*),([*#])", "$1$2")));
            yield return new(m.Groups[1].Value, name == "" ? m.Groups[1].Value : name, file, datetree, body);
            i = j;
        }
    }

    /// <summary>A file's `#+PROPERTY: KEY_ALL a b "c d"` lines, by property name: the values to offer in the capture.</summary>
    public static Dictionary<string, List<string>> PropertyOptions(string text)
    {
        var out_ = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var l in text.Split('\n'))
        {
            if (HeadlineRe().IsMatch(l)) break;
            if (PropertyAllRe().Match(l) is { Success: true } m)
                out_[m.Groups[1].Value] = Regex.Matches(m.Groups[2].Value, "\"([^\"]*)\"|(\\S+)").Select(v => v.Groups[1].Success ? v.Groups[1].Value : v.Groups[2].Value).ToList();
        }
        return out_;
    }

    /// <summary>Fills a template: %{title}, %{body}, %{when} (line dropped when empty), %{time}, %U, %T, and empty properties from `props`.</summary>
    public static List<string> Expand(CaptureTemplate t, string title, string body, DateOnly? date, TimeOnly? time, DateTime now, Dictionary<string, string>? props = null)
    {
        var when = date is { } d ? Stamp(true, d, time) : "";
        var bodyLines = body.Trim().Length > 0 ? body.TrimEnd().Split('\n') : [];
        var nowTime = TimeOnly.FromDateTime(now);
        var today = DateOnly.FromDateTime(now);
        var out_ = new List<string>();
        foreach (var l in t.Body.Split('\n'))
        {
            if (l.Contains("%{when}") && when == "") continue;
            if (l.Trim() == "%{body}")
            {
                out_.AddRange(bodyLines);
                continue;
            }
            if (EmptyPropRe().Match(l) is { Success: true } prop && props?.GetValueOrDefault(prop.Groups[2].Value)?.Trim() is { Length: > 0 } value)
            {
                out_.Add($"{prop.Groups[1].Value}:{prop.Groups[2].Value}: {value}");
                continue;
            }
            out_.Add(l.Replace("%{title}", title).Replace("%{when}", when).Replace("%{time}", nowTime.ToString("HH:mm"))
                .Replace("%U", Stamp(false, today, nowTime)).Replace("%T", Stamp(true, today, nowTime)).Replace("%{body}", body.Trim()));
        }
        // A template without %{body} still keeps what was written, at the end of the entry.
        if (!t.Body.Contains("%{body}")) out_.AddRange(bodyLines);
        return out_;
    }

    private static string Stamp(bool active, DateOnly date, TimeOnly? time)
    {
        var s = $"{date:yyyy-MM-dd} {DayNames[(int)date.DayOfWeek]}{(time is { } t ? " " + t.ToString("HH:mm") : "")}";
        return active ? $"<{s}>" : $"[{s}]";
    }

    private record Head(int Level, string Title, int Line, int End, int Parent);

    private static List<Head> Heads(List<string> lines)
    {
        var raw = new List<(int Level, string Title, int Line)>();
        for (var i = 0; i < lines.Count; i++)
            if (HeadlineRe().Match(lines[i]) is { Success: true } m) raw.Add((m.Groups[1].Length, m.Groups[2].Value.Trim(), i));
        var heads = new List<Head>();
        var stack = new Stack<int>();
        for (var n = 0; n < raw.Count; n++)
        {
            while (stack.Count > 0 && raw[stack.Peek()].Level >= raw[n].Level) stack.Pop();
            var end = lines.Count;
            for (var k = n + 1; k < raw.Count; k++)
                if (raw[k].Level <= raw[n].Level)
                {
                    end = raw[k].Line;
                    break;
                }
            heads.Add(new(raw[n].Level, raw[n].Title, raw[n].Line, end, stack.Count > 0 ? stack.Peek() : -1));
            stack.Push(n);
        }
        return heads;
    }

    /// <summary>Appends an entry to `text`, optionally under a year/month/day datetree like org-capture's file+olp+datetree.</summary>
    public static string CaptureInto(string text, List<string> entry, bool datetree, DateTime now)
    {
        var lines = text.Length > 0 ? text.TrimEnd('\n').Split('\n').ToList() : [];
        if (!datetree) return string.Join('\n', [.. lines, .. entry, ""]);

        var en = CultureInfo.InvariantCulture;
        string[] path = [$"{now:yyyy}", $"{now:yyyy-MM} {now.ToString("MMMM", en)}", $"{now:yyyy-MM-dd} {now.ToString("dddd", en)}"];
        var parent = -1;
        var parentEnd = lines.Count;
        for (var level = 1; level <= 3; level++)
        {
            var heads = Heads(lines);
            var siblings = Enumerable.Range(0, heads.Count).Where(i => heads[i].Parent == parent).ToList();
            var title = path[level - 1];
            var found = siblings.FirstOrDefault(i => heads[i].Title == title, -1);
            if (found < 0)
            {
                // Insert in sorted (ordinal) position among siblings, as the client does.
                var after = siblings.LastOrDefault(i => string.CompareOrdinal(heads[i].Title, title) < 0, -1);
                var pos = after >= 0 ? heads[after].End : siblings.Count > 0 ? heads[siblings[0]].Line : parentEnd;
                lines.Insert(pos, $"{new string('*', level)} {title}");
                heads = Heads(lines);
                found = heads.FindIndex(h => h.Line == pos);
            }
            parent = found;
            parentEnd = heads[found].End;
        }
        lines.InsertRange(parentEnd, entry);
        return string.Join('\n', lines) + "\n";
    }
}
