using System.Globalization;
using System.Text.Json;

namespace OrgNotes.Server;

/// <summary>An item proposed from free text, ready to be captured with its template.</summary>
public record ProposedItem(string File, string Key, string Template, string Title, string Date, string Time, string Body, Dictionary<string, string> Props, List<string> Tags);

/// <summary>
/// Turns free text (an email, notes) into items for the user's capture templates with the AI: builds the context from
/// the user's own templates and field options (e.g. the clients from the contacts), then keeps only what fits them.
/// </summary>
public class Extraction(AiAssistant ai)
{
    public const int MaxText = 20_000;

    private static readonly Dictionary<string, string> LanguageNames = new()
    {
        ["pt"] = "European Portuguese", ["en"] = "English", ["fr"] = "French", ["es"] = "Spanish",
    };

    public async Task<List<ProposedItem>> Run(OrgStore store, string text, DateTime now, string lang, CancellationToken ct)
    {
        var templates = store.List().SelectMany(f =>
        {
            var content = store.Read(f.Path) ?? "";
            var options = OrgCapture.FieldOptions(f.Path, content, store.Read);
            return OrgCapture.TemplatesIn(f.Path, content).Select(t => (Id: $"{t.File}#{t.Key}", Template: t, Options: options));
        }).ToList();
        if (templates.Count == 0) return [];
        var context = JsonSerializer.Serialize(templates.Select(x => new
        {
            id = x.Id,
            name = x.Template.Name,
            file = x.Template.File,
            text = x.Template.Body,
            takesDate = x.Template.UsesWhen,
            fields = x.Template.Props.Select(p => new { name = p, options = x.Options.GetValueOrDefault(p) ?? [] }),
        }));
        var nowText = now.ToString("yyyy-MM-dd (dddd) HH:mm", CultureInfo.InvariantCulture);
        // The model only picks among the tags already in use, so the notes do not fill with near-duplicates.
        var known = store.List().SelectMany(f => OrgCapture.Tags(store.Read(f.Path) ?? "")).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var raw = await ai.Extract(text.Length > MaxText ? text[..MaxText] : text, nowText, LanguageNames.GetValueOrDefault(lang, "European Portuguese"), context, JsonSerializer.Serialize(known), ct);

        // The model only proposes: unknown templates, foreign fields and malformed dates are dropped.
        var byId = templates.ToDictionary(x => x.Id, x => x.Template);
        return raw.Where(r => byId.ContainsKey(r.Template) && !string.IsNullOrWhiteSpace(r.Title)).Select(r =>
        {
            var t = byId[r.Template];
            var date = t.UsesWhen && DateOnly.TryParseExact(r.Date, "yyyy-MM-dd", out _) ? r.Date : "";
            var time = date != "" && TimeOnly.TryParseExact(r.Time, "HH:mm", out _) ? r.Time : "";
            var props = new Dictionary<string, string>();
            foreach (var f in r.Fields)
                if (t.Props.FirstOrDefault(p => p.Equals(f.Name, StringComparison.OrdinalIgnoreCase)) is { } name && f.Value.Trim() is { Length: > 0 } value)
                    props[name] = value;
            var tags = r.Tags.Select(x => known.FirstOrDefault(k => k.Equals(x.Trim(), StringComparison.OrdinalIgnoreCase))).OfType<string>().Distinct().ToList();
            return new ProposedItem(t.File, t.Key, t.Name, r.Title.Trim(), date, time, r.Body.Trim(), props, tags);
        }).ToList();
    }
}
