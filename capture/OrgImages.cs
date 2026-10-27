using System.Text.RegularExpressions;

namespace OrgNotes.Capture;

/// <summary>Image links in a note and their width, as the web's org/images.ts: an #+ATTR_ORG: :width line before them.</summary>
public static partial class OrgImages
{
    [GeneratedRegex(@"\[\[(?:file:)?([^\[\]]+?\.(?:png|jpe?g|gif|webp))\]\]", RegexOptions.IgnoreCase)] public static partial Regex LinkRe();
    [GeneratedRegex(@"^\s*#\+attr_(?:org|html):.*?:width\s+(\d+)(?:px)?\b", RegexOptions.IgnoreCase)] private static partial Regex WidthRe();
    [GeneratedRegex(@"^\s*#\+attr_org:", RegexOptions.IgnoreCase)] private static partial Regex OrgAttrRe();
    [GeneratedRegex(@"\s*:width\s+\S+", RegexOptions.IgnoreCase)] private static partial Regex WidthAttrRe();

    /// <summary>The width in pixels the line before the image at <paramref name="offset"/> gives it, if any.</summary>
    public static int? Width(string text, int offset)
    {
        var lines = text.Split('\n');
        var idx = text[..offset].Count(c => c == '\n');
        return idx > 0 && WidthRe().Match(lines[idx - 1]) is { Success: true } m ? int.Parse(m.Groups[1].Value) : null;
    }

    /// <summary>Sets (or, without a width, removes) the width in an #+ATTR_ORG: line just before the image's line.</summary>
    public static string SetWidth(string text, int offset, int? width)
    {
        var lines = text.Split('\n').ToList();
        var idx = text[..offset].Count(c => c == '\n');
        var indent = new string(lines[idx].TakeWhile(char.IsWhiteSpace).ToArray());
        if (idx > 0 && OrgAttrRe().IsMatch(lines[idx - 1]))
        {
            var rest = WidthAttrRe().Replace(OrgAttrRe().Replace(lines[idx - 1], ""), "").Trim();
            if (width is { } w) rest = $":width {w}{(rest == "" ? "" : " " + rest)}";
            if (rest == "") lines.RemoveAt(idx - 1);
            else lines[idx - 1] = $"{indent}#+ATTR_ORG: {rest}";
        }
        else if (width is { } w) lines.Insert(idx, $"{indent}#+ATTR_ORG: :width {w}");
        return string.Join('\n', lines);
    }

    /// <summary>A link's target as a path from the notes' root, relative to the note's file (as org and the web).</summary>
    public static string Resolve(string from, string target)
    {
        var parts = new List<string>(from.Split('/')[..^1]);
        foreach (var p in target.Split('/'))
            if (p == "..") { if (parts.Count > 0) parts.RemoveAt(parts.Count - 1); }
            else if (p is not ("" or ".")) parts.Add(p);
        return string.Join('/', parts);
    }
}
