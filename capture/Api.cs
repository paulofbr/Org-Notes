using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace OrgNotes.Capture;

public record Template(string Key, string Name, string File, bool Datetree, bool UsesWhen, List<string>? Props, Dictionary<string, List<string>>? Options);

public record Improved(Dictionary<string, string> Fields, string[] Changes);

public record Me(bool Ai, string? Lang, string? WindowsVersion);

public record Reminder(string Id, DateTime From, DateTime Until, string Title, string Body);

/// <summary>The Org Notes server's capture endpoints, authenticated with the user's personal token.</summary>
public class Api(Config config)
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(90) };
    private static readonly JsonSerializerOptions Json = JsonSerializerOptions.Web;

    private HttpRequestMessage Request(HttpMethod method, string path)
    {
        var request = new HttpRequestMessage(method, config.Server.TrimEnd('/') + path);
        if (config.Token != "") request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.Token);
        return request;
    }

    public async Task<List<Template>> Templates()
    {
        using var response = await Http.SendAsync(Request(HttpMethod.Get, "/api/capture/templates"));
        await Check(response);
        return await response.Content.ReadFromJsonAsync<List<Template>>(Json) ?? [];
    }

    /// <summary>Whether the server has AI proofreading configured, and the user's interface language.</summary>
    public async Task<Me> Me()
    {
        using var response = await Http.SendAsync(Request(HttpMethod.Get, "/api/me"));
        await Check(response);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        string? Text(string name) => root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        return new(root.TryGetProperty("ai", out var ai) && ai.GetBoolean(), Text("lang"), Text("windowsVersion"));
    }

    public async Task<Improved> Improve(Dictionary<string, string> fields, string mode)
    {
        var request = Request(HttpMethod.Post, "/api/ai/improve");
        request.Content = JsonContent.Create(new { fields, mode }, options: Json);
        using var response = await Http.SendAsync(request);
        if ((int)response.StatusCode is 400 or >= 404)
        {
            // The server explains AI failures in a problem+json "detail".
            var text = await response.Content.ReadAsStringAsync();
            string? detail = null;
            try { detail = JsonDocument.Parse(text).RootElement.GetProperty("detail").GetString(); }
            catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException) { }
            throw new HttpRequestException(detail ?? L.Tr("Erro {0}: {1}", (int)response.StatusCode, text));
        }
        await Check(response);
        return await response.Content.ReadFromJsonAsync<Improved>(Json) ?? throw new HttpRequestException(L.Tr("Resposta vazia."));
    }

    public async Task Capture(Template t, string title, string body, DateOnly? date, TimeOnly? time, Dictionary<string, string> props)
    {
        var request = Request(HttpMethod.Post, "/api/capture");
        request.Content = JsonContent.Create(new { file = t.File, key = t.Key, title, body, date, time, props, now = DateTime.Now }, options: Json);
        using var response = await Http.SendAsync(request);
        await Check(response);
    }

    /// <summary>Uploads an image next to <paramref name="file"/>'s notes; returns its path from the notes' root.</summary>
    public async Task<string> UploadImage(string file, byte[] image)
    {
        var request = Request(HttpMethod.Post, $"/api/images?file={Uri.EscapeDataString(file)}");
        request.Content = new ByteArrayContent(image);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        using var response = await Http.SendAsync(request);
        await Check(response);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("path").GetString() ?? throw new HttpRequestException(L.Tr("Resposta vazia."));
    }

    /// <summary>Saves the server's Windows installer to <paramref name="path"/>.</summary>
    public async Task DownloadInstaller(string path)
    {
        using var response = await Http.SendAsync(Request(HttpMethod.Get, "/api/downloads/windows"), HttpCompletionOption.ResponseHeadersRead);
        await Check(response);
        await using var file = File.Create(path);
        await response.Content.CopyToAsync(file);
    }

    /// <summary>Today's reminders, worked out by the server for this machine's wall-clock time.</summary>
    public async Task<List<Reminder>> Reminders(DateTime now)
    {
        using var response = await Http.SendAsync(Request(HttpMethod.Get, $"/api/reminders?now={now:yyyy-MM-ddTHH:mm:ss}"));
        await Check(response);
        return await response.Content.ReadFromJsonAsync<List<Reminder>>(Json) ?? [];
    }

    private static async Task Check(HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode) return;
        var text = await response.Content.ReadAsStringAsync();
        throw new HttpRequestException((int)response.StatusCode switch
        {
            401 => L.Tr("Token em falta ou inválido (vê Conta e notificações no site)."),
            403 => L.Tr("Este utilizador não tem acesso ao servidor."),
            _ => L.Tr("Erro {0}: {1}", (int)response.StatusCode, text.Trim('"')),
        });
    }
}
