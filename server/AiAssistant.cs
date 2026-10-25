using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Anthropic;
using Anthropic.Exceptions;
using Anthropic.Models.Beta.Messages;

namespace OrgNotes.Server;

public record ImproveResult(Dictionary<string, string> Fields, string[] Changes);

public record PropertyChoice(string Property, string[] Values);

public record TemplateDraft(string Name, bool Datetree, string Body, PropertyChoice[] Options);

/// <summary>
/// Revises org-mode text with an LLM in one of several <see cref="Modes"/>. With `Ai:BaseUrl` set it calls any OpenAI-compatible `/chat/completions`
/// endpoint (Gemini, Groq, Mistral, OpenRouter, Ollama...); otherwise it calls Claude with the Anthropic API key.
/// </summary>
public class AiAssistant(IConfiguration config, IHttpClientFactory http)
{
    /// <summary>What each mode asks for; the shared rules below apply to all of them.</summary>
    public static readonly Dictionary<string, string> Modes = new()
    {
        ["develop"] = """
            Improve and develop the notes:
            - Fix spelling, grammar and punctuation.
            - Improve clarity: turn terse or fragmentary notes into clear, well-written text.
            - Develop the content: expand the ideas that are there, make implicit points explicit, add useful structure
              (paragraphs, lists, checkbox items for actions or next steps) and relevant considerations the author would
              likely want, staying close to their intent. Prefer a moderate expansion over a long essay.
            """,
        ["fix"] = """
            Only fix spelling, grammar, punctuation and clearly awkward wording. Keep everything else exactly as written:
            do not add, remove, reorder or restructure content. Return a field unchanged if it needs no fix.
            """,
        ["summarize"] = """
            Condense the notes to their essentials: a short summary (a few lines or a short list) that keeps every
            decision, action and key fact. Also fix language errors.
            """,
        ["formal"] = """
            Rewrite the notes in a clear, professional tone suitable for sharing with colleagues or clients, keeping the
            content and structure. Also fix language errors.
            """,
        ["tasks"] = """
            Turn the notes into actionable tasks: a list of "- [ ]" checkbox items, one concrete action each, starting
            with a verb, keeping any context lines that matter. Also fix language errors.
            """,
    };

    private const string Rules = """
        Always:
        - Write in the author's language (usually European Portuguese; never translate) and voice.
        - Never invent specific facts: no new names, dates, numbers, places, quotes or claims that are not implied by
          the text. If something is needed but unknown, leave a short placeholder such as [definir].
        - A title (key "title") stays a short, single-line headline: only fix and sharpen it, do not expand it.
        - Preserve existing org-mode markup exactly: headline stars, TODO keywords, priorities, tags, timestamps,
          SCHEDULED/DEADLINE lines, drawers, links, tables and code blocks. New text must be org-mode, never Markdown:
          - lists, - [ ] checkboxes, *bold* with ONE asterisk each side (never **bold**), /italic/, no # headings;
          never add headlines (lines starting with *) to a body.
        Each input field is handled independently and returned under the same key; an empty field stays empty.
        In `changes`, summarize what you changed, a few words each, in the author's language; empty if nothing.
        Answer with JSON only: {"fields": {<same keys>: <text>}, "changes": [<text>]}.
        """;

    private const string TemplateInstructions = """
        You write org-mode capture templates for a notes app from the author's description of what they want to capture.
        A template body is org-mode text with these placeholders:
        - %{title}: the title typed in the capture (use it in the entry's headline);
        - %{body}: the notes typed in the capture, on a line of its own;
        - %{when}: a date/time chosen in the capture, e.g. "SCHEDULED: %{when}" or "DEADLINE: %{when}" (the line is dropped when no date is chosen);
        - %{time}: the current time (HH:MM); %U / %T: now as an inactive / active timestamp.
        Rules:
        - Start with one headline using %{title}, e.g. "* %{title}" or "* TODO %{title}" for tasks. Level 1, or level 4 ("****") when datetree is true.
        - Data the author wants to ask for in each capture goes in a property drawer as empty properties, one per line:
          ":PROPERTIES:", ":EMAIL:", ":END:". Property names are short, upper-case, without spaces, in the author's language.
        - When the description gives a fixed set of values for a property, return them in `options` (property name as in the drawer).
          Never invent values the description does not give.
        - Set datetree true only for journal/log-like captures filed by day.
        - `name` is a short name for the template in the author's language (usually European Portuguese).
        - Use org-mode, never Markdown. End the body with %{body} unless the author asks otherwise.
        Answer with JSON only: {"name": <text>, "datetree": <bool>, "body": <text>, "options": [{"property": <text>, "values": [<text>]}]}.
        """;

    public async Task<TemplateDraft> Template(string description, CancellationToken ct)
    {
        var schema = new
        {
            type = "object",
            additionalProperties = false,
            required = new[] { "name", "datetree", "body", "options" },
            properties = new
            {
                name = new { type = "string" },
                datetree = new { type = "boolean" },
                body = new { type = "string" },
                options = new
                {
                    type = "array",
                    items = new
                    {
                        type = "object",
                        additionalProperties = false,
                        required = new[] { "property", "values" },
                        properties = new { property = new { type = "string" }, values = new { type = "array", items = new { type = "string" } } },
                    },
                },
            },
        };
        var input = new Dictionary<string, string> { ["description"] = description };
        var json = _baseUrl != null
            ? await OpenAiCompatible(input, schema, TemplateInstructions, ct)
            : await Claude(input, schema, TemplateInstructions, ct);
        json = Regex.Replace(json.Trim(), @"^```(?:json)?\s*|\s*```$", "");
        return JsonSerializer.Deserialize<TemplateDraft>(json, JsonSerializerOptions.Web)
            ?? throw new InvalidOperationException("Resposta vazia do modelo.");
    }

    private static string Instructions(string mode) =>
        "You help the author with notes written in Emacs org-mode syntax.\n" + Modes.GetValueOrDefault(mode, Modes["develop"]) + Rules;

    private readonly string? _baseUrl = config["Ai:BaseUrl"] is { Length: > 0 } u ? u.TrimEnd('/') : null;
    private readonly string? _key = config["Ai:ApiKey"] is { Length: > 0 } k ? k
        : string.IsNullOrEmpty(config["Ai:BaseUrl"]) ? Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY") : null;
    private AnthropicClient? _client;

    // Local servers such as Ollama need no key.
    public bool Enabled => _baseUrl != null || !string.IsNullOrEmpty(_key);

    public async Task<ImproveResult> Improve(Dictionary<string, string> fields, string mode, CancellationToken ct)
    {
        var schema = new
        {
            type = "object",
            additionalProperties = false,
            required = new[] { "fields", "changes" },
            properties = new
            {
                fields = new
                {
                    type = "object",
                    additionalProperties = false,
                    required = fields.Keys.ToArray(),
                    properties = fields.Keys.ToDictionary(k => k, _ => new { type = "string" }),
                },
                changes = new { type = "array", items = new { type = "string" } },
            },
        };
        var json = _baseUrl != null
            ? await OpenAiCompatible(fields, schema, Instructions(mode), ct)
            : await Claude(fields, schema, Instructions(mode), ct);
        // Some models wrap JSON in a ```json fence despite the response format.
        json = Regex.Replace(json.Trim(), @"^```(?:json)?\s*|\s*```$", "");
        return JsonSerializer.Deserialize<ImproveResult>(json, JsonSerializerOptions.Web)
            ?? throw new InvalidOperationException("Resposta vazia do modelo.");
    }

    private async Task<string> Claude(Dictionary<string, string> fields, object schema, string instructions, CancellationToken ct)
    {
        _client ??= new AnthropicClient { ApiKey = _key };
        var response = await _client.Beta.Messages.Create(new MessageCreateParams
        {
            Model = config["Ai:Model"] is { Length: > 0 } m ? m : "claude-opus-5-5",
            MaxTokens = 16000,
            Betas = ["server-side-fallback-2026-07-01"],
            Fallbacks = new Default(),
            OutputConfig = new BetaOutputConfig
            {
                Effort = Effort.Low,
                Format = new BetaJsonOutputFormat
                {
                    Schema = JsonSerializer.SerializeToElement(schema).EnumerateObject().ToDictionary(p => p.Name, p => p.Value),
                },
            },
            System = instructions,
            Messages = [new BetaUserMessageParam { Content = JsonSerializer.Serialize(fields) }],
        }, ct);

        if (response.StopReason == "refusal") throw new InvalidOperationException("O pedido foi recusado pelo modelo.");
        return string.Concat(response.Content.Select(b => b.Value).OfType<BetaTextBlock>().Select(t => t.Text));
    }

    /// <summary>
    /// `Ai:Model` may list several models ("a,b,c"): when one is out of quota (429) or overloaded (503), the next is
    /// tried — free tiers have small per-model daily limits.
    /// </summary>
    private async Task<string> OpenAiCompatible(Dictionary<string, string> fields, object schema, string instructions, CancellationToken ct)
    {
        var models = (config["Ai:Model"] ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (models.Length == 0) throw new InvalidOperationException("Falta configurar Ai:Model.");
        var client = http.CreateClient();
        for (var i = 0; ; i++)
        {
            var (status, text) = await Post(client, models[i], fields, schema, instructions, ct);
            if (status == HttpStatusCode.OK) return ContentOf(text);
            if (i == models.Length - 1 || status is not (HttpStatusCode.TooManyRequests or HttpStatusCode.ServiceUnavailable))
                throw new HttpRequestException(text, null, status);
        }
    }

    private async Task<(HttpStatusCode, string)> Post(HttpClient client, string model, Dictionary<string, string> fields, object schema, string instructions, CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(new
        {
            model,
            messages = new object[]
            {
                new { role = "system", content = instructions },
                new { role = "user", content = JsonSerializer.Serialize(fields) },
            },
            response_format = new { type = "json_schema", json_schema = new { name = "proofread", strict = true, schema } },
        });
        // "High demand" 503s are often momentary: retry the same model twice first.
        for (var attempt = 1; ; attempt++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/chat/completions")
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            };
            if (!string.IsNullOrEmpty(_key)) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _key);
            using var response = await client.SendAsync(request, ct);
            var text = await response.Content.ReadAsStringAsync(ct);
            if (response.StatusCode == HttpStatusCode.ServiceUnavailable && attempt < 3)
            {
                await Task.Delay(TimeSpan.FromSeconds(attempt), ct);
                continue;
            }
            return (response.IsSuccessStatusCode ? HttpStatusCode.OK : response.StatusCode, text);
        }
    }

    private static string ContentOf(string text)
    {
        using var doc = JsonDocument.Parse(text);
        return doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString() ?? "";
    }

    /// <summary>The provider's own error message (e.g. "credit balance too low"), if the error text carries one.</summary>
    public static string ProviderMessage(Exception e) =>
        Regex.Match(e.Message, "\"message\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"") is { Success: true } m ? Regex.Unescape(m.Groups[1].Value) : e.Message;

    public static bool IsRateLimit(Exception e) => e is AnthropicRateLimitException || e is HttpRequestException { StatusCode: HttpStatusCode.TooManyRequests };
}
