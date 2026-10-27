using Anthropic.Exceptions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.RateLimiting;
using OrgNotes.Server;

var builder = WebApplication.CreateBuilder(args);
// Machine-local secrets (API keys), kept out of git.
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true);
// Re-added so environment variables still override the local file.
builder.Configuration.AddEnvironmentVariables();

var root = Path.GetFullPath(builder.Configuration["OrgDirectory"] ?? "data", builder.Environment.ContentRootPath);
// Email and password always; Google and Microsoft sign-in too when their ClientId and ClientSecret are set.
var google = builder.Configuration.GetSection("Auth:Google");
var microsoft = builder.Configuration.GetSection("Auth:Microsoft");
var allowed = builder.Configuration.GetSection("Auth:AllowedEmails").Get<string[]>() ?? [];
var access = new Access(root, allowed, builder.Configuration.GetSection("Auth:Admins").Get<string[]>() ?? []);
builder.Services.AddSingleton(access);
builder.Services.AddSingleton<Extraction>();
builder.Services.AddSingleton<MailInbox>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<MailInbox>());

builder.Services.AddSingleton(new Users(root, Path.Combine(AppContext.BaseDirectory, "Seed")));
// Each note's old `_images` and `_attachments` folders go into its `_Artifacts` folder, links included (once; then a no-op).
if (Directory.Exists(Path.Combine(root, "users")))
    foreach (var userDir in Directory.EnumerateDirectories(Path.Combine(root, "users")))
        Artifacts.Migrate(userDir, Console.Error.WriteLine);
var windowsInstaller = Path.Combine(AppContext.BaseDirectory, "downloads", "OrgNotes-client-win-x64.zip");
// The commit the installer was built from, for the app to update itself (see capture/Updater.cs).
var windowsVersion = Path.ChangeExtension(windowsInstaller, ".version");
builder.Services.AddHttpClient();
builder.Services.AddSingleton<AiAssistant>();
builder.Services.AddSingleton<Notifier>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<Notifier>());
var auth = builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.LoginPath = "/login";
        o.ExpireTimeSpan = TimeSpan.FromDays(30);
        o.SlidingExpiration = true;
    });
List<string> providers = [];
if (!string.IsNullOrEmpty(google["ClientId"]) && !string.IsNullOrEmpty(google["ClientSecret"]))
{
    providers.Add("Google");
    auth.AddGoogle(o =>
    {
        o.ClientId = google["ClientId"]!;
        o.ClientSecret = google["ClientSecret"]!;
    });
}
if (!string.IsNullOrEmpty(microsoft["ClientId"]) && !string.IsNullOrEmpty(microsoft["ClientSecret"]))
{
    // The default "common" endpoints accept both work/school (Microsoft 365) and personal accounts.
    providers.Add("Microsoft");
    auth.AddMicrosoftAccount(o =>
    {
        o.ClientId = microsoft["ClientId"]!;
        o.ClientSecret = microsoft["ClientSecret"]!;
    });
}
// Slows down password guessing: 10 login attempts per minute per IP.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();
app.Logger.LogInformation("Org directory: {Root} (login: password{Providers})", root, string.Concat(providers.Select(p => ", " + p)));
if (allowed.Length == 0) app.Logger.LogWarning("Auth:AllowedEmails is empty: nobody can sign in");

// Behind a reverse proxy (Caddy, tailscale serve) so the sign-in redirect URLs use https.
app.UseForwardedHeaders(new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost });

app.UseAuthentication();
app.UseRateLimiter();
app.Use(async (ctx, next) =>
{
    // The login page and its icons are open to everyone.
    if (ctx.Request.Path.StartsWithSegments("/login") || ctx.Request.Path == "/logout"
        || ctx.Request.Path == "/favicon.svg" || ctx.Request.Path == "/apple-touch-icon.png")
    {
        await next();
        return;
    }
    // The capture app authenticates with the user's personal token instead of the session cookie.
    if (ctx.User.Identity?.IsAuthenticated != true && ctx.Request.Headers.Authorization.ToString() is var bearer
        && bearer.StartsWith("Bearer ") && ctx.RequestServices.GetRequiredService<Users>().KeyForToken(bearer[7..]) is { } tokenUser)
        ctx.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Email, tokenUser)], "token"));
    if (ctx.User.Identity?.IsAuthenticated != true)
    {
        // fetch() cannot follow a redirect to the login page, so the API answers 401 and the page reloads into it.
        if (ctx.Request.Path.StartsWithSegments("/api")) ctx.Response.StatusCode = 401;
        else await ctx.ChallengeAsync(new AuthenticationProperties { RedirectUri = ctx.Request.Path + ctx.Request.QueryString });
        return;
    }
    var email = ctx.User.FindFirstValue(ClaimTypes.Email) ?? "";
    if (!access.IsAllowed(email))
    {
        ctx.Response.StatusCode = 403;
        await ctx.Response.WriteAsync(Strings.Tr(ctx, "Sem acesso: {0} não está autorizado. Sair: /logout", email));
        return;
    }
    await next();
});
Login.Map(app, access, [.. providers]);

app.UseDefaultFiles();
// index.html must be revalidated so a new build shows up on reload; hashed assets can stay cached.
var staticOptions = new StaticFileOptions
{
    OnPrepareResponse = c =>
    {
        if (c.File.Name == "index.html") c.Context.Response.Headers.CacheControl = "no-cache";
    },
};
app.UseStaticFiles(staticOptions);

var files = app.MapGroup("/api/files");

files.MapGet("/", (HttpContext ctx, Users users) => users.For(ctx.User).List());

files.MapGet("/{*path}", (string path, HttpContext ctx, Users users) =>
    users.For(ctx.User).Read(path) is { } text ? Results.Text(text, "text/plain; charset=utf-8") : Results.NotFound());

files.MapPut("/{*path}", async (string path, HttpContext ctx, Users users) =>
{
    using var reader = new StreamReader(ctx.Request.Body);
    var text = await reader.ReadToEndAsync();
    return users.For(ctx.User).Write(path, text) is { } info ? Results.Ok(info) : Results.BadRequest("Invalid path");
});

files.MapDelete("/{*path}", (string path, HttpContext ctx, Users users) => users.For(ctx.User).Delete(path) ? Results.NoContent() : Results.NotFound());

app.MapGet("/api/folders", (HttpContext ctx, Users users) => users.For(ctx.User).Folders());

app.MapPost("/api/folders", (FolderRequest req, HttpContext ctx, Users users) =>
    users.For(ctx.User).CreateFolder(req.Path) ? Results.NoContent() : Results.BadRequest(Strings.Tr(ctx, "Nome de pasta inválido")));

app.MapDelete("/api/folders/{*path}", (string path, HttpContext ctx, Users users) =>
    users.For(ctx.User).DeleteFolder(path) ? Results.NoContent() : Results.BadRequest(Strings.Tr(ctx, "Só se pode apagar uma pasta vazia")));

app.MapPost("/api/rename", (RenameRequest req, HttpContext ctx, Users users) =>
    users.For(ctx.User).Rename(req.From, req.To) ? Results.NoContent() : Results.BadRequest("Cannot rename"));

// Who may sign in, for the administrator: the configured emails (fixed) and the ones added here.
app.MapGet("/api/admin/logins", (HttpContext ctx, Users users) =>
    !IsAdmin(ctx) ? Results.StatusCode(403) : Results.Ok(
        access.Configured.Select(e => (Email: e, Fixed: true)).Concat(access.Added.Select(e => (Email: e, Fixed: false)))
            .Select(l => new { email = l.Email, @fixed = l.Fixed, admin = access.IsAdmin(l.Email), hasPassword = users.HasPassword(Users.KeyOfEmail(l.Email)) })));

app.MapPost("/api/admin/logins", (LoginRequest req, HttpContext ctx) =>
    !IsAdmin(ctx) ? Results.StatusCode(403)
    : access.Add(req.Email) ? Results.NoContent() : Results.BadRequest(Strings.Tr(ctx, "Email inválido ou já autorizado")));

app.MapDelete("/api/admin/logins/{email}", (string email, HttpContext ctx) =>
    !IsAdmin(ctx) ? Results.StatusCode(403)
    : access.Remove(email) ? Results.NoContent() : Results.BadRequest(Strings.Tr(ctx, "Só se podem retirar os emails acrescentados aqui")));

bool IsAdmin(HttpContext ctx) => access.IsAdmin(ctx.User.FindFirstValue(ClaimTypes.Email) ?? "");

// Every tag in use, for picking tags in the capture app.
app.MapGet("/api/tags", (HttpContext ctx, Users users) =>
{
    var store = users.For(ctx.User);
    return store.List().SelectMany(f => OrgCapture.Tags(store.Read(f.Path) ?? "")).Distinct().Order(StringComparer.CurrentCultureIgnoreCase);
});

// Every file and its headlines, for the capture app's internal links.
app.MapGet("/api/link-targets", (HttpContext ctx, Users users) =>
{
    var store = users.For(ctx.User);
    return store.List().Select(f => new { file = f.Path, headings = OrgAgenda.Titles(store.Read(f.Path) ?? "") });
});

// The user's reminders for the day, for the capture app to show natively. `now` is the user's wall-clock time,
// since the server may be in another time zone.
app.MapGet("/api/reminders", (DateTime? now, HttpContext ctx, Users users, Notifier notifier) =>
    notifier.Reminders(users.Key(ctx.User), now ?? DateTime.Now));

// The mailbox the AI reads for items (password never sent back), and the emails waiting for review.
app.MapGet("/api/mail", (HttpContext ctx, Users users) =>
    users.Settings(users.Key(ctx.User)).Mail is { } m
        ? Results.Ok(new { host = m.Host, port = m.Port, user = m.User, folder = m.Folder, enabled = m.Enabled, lastCheck = m.LastCheck, lastError = m.LastError })
        : Results.Ok((object?)null));

app.MapPut("/api/mail", async (MailRequest req, HttpContext ctx, Users users, MailInbox inbox, CancellationToken ct) =>
{
    var key = users.Key(ctx.User);
    var old = users.Settings(key).Mail;
    // An empty password keeps the saved one.
    var password = string.IsNullOrEmpty(req.Password) ? (old != null ? inbox.Password(old) : null) : req.Password;
    if (string.IsNullOrWhiteSpace(req.Host) || string.IsNullOrWhiteSpace(req.User) || password == null) return Results.BadRequest(Strings.Tr(ctx, "Falta o servidor, o utilizador ou a password"));
    var account = new MailAccount(req.Host.Trim(), req.Port is > 0 ? req.Port : 993, req.User.Trim(), inbox.Protect(password), string.IsNullOrWhiteSpace(req.Folder) ? "INBOX" : req.Folder.Trim(), req.Enabled);
    try
    {
        // Saved only once it connects; it reads from now on, never the mails already there.
        var (validity, next) = await inbox.Test(account, password, ct);
        users.Save(key, users.Settings(key) with { Mail = account with { UidValidity = validity, LastUid = next - 1 } });
        return Results.NoContent();
    }
    catch (Exception e) when (e is not OperationCanceledException)
    {
        return Results.BadRequest(Strings.Tr(ctx, "Não foi possível ligar ao email: {0}", e.Message));
    }
});

app.MapDelete("/api/mail", (HttpContext ctx, Users users) =>
{
    var key = users.Key(ctx.User);
    users.Save(key, users.Settings(key) with { Mail = null });
    return Results.NoContent();
});

app.MapPost("/api/mail/check", async (HttpContext ctx, Users users, MailInbox inbox, CancellationToken ct) =>
{
    var key = users.Key(ctx.User);
    await inbox.Check(key, ct);
    return Results.Ok(new { lastError = users.Settings(key).Mail?.LastError, inbox = inbox.Inbox(key).Count });
});

app.MapGet("/api/inbox", (HttpContext ctx, Users users, MailInbox inbox) => inbox.Inbox(users.Key(ctx.User)));

app.MapDelete("/api/inbox/{id}", (string id, HttpContext ctx, Users users, MailInbox inbox) =>
    inbox.Remove(users.Key(ctx.User), id) ? Results.NoContent() : Results.NotFound());

app.MapGet("/api/me", (HttpContext ctx, Users users, Notifier notifier, AiAssistant ai, MailInbox inbox) =>
{
    var s = users.Settings(users.Key(ctx.User));
    return new { email = ctx.User.FindFirstValue(ClaimTypes.Email), ai = ai.Enabled, token = users.Token(users.Key(ctx.User)), ntfy = new { server = notifier.NtfyServer, topic = s.NtfyTopic, enabled = s.Notify }, lang = s.Lang, inbox = inbox.Inbox(users.Key(ctx.User)).Count, admin = access.IsAdmin(ctx.User.FindFirstValue(ClaimTypes.Email) ?? ""), windowsInstaller = File.Exists(windowsInstaller),
        windowsVersion = File.Exists(windowsVersion) ? File.ReadAllText(windowsVersion).Trim() : null };
});

// The local app's Windows installer, which the server package carries (absent when running from source).
app.MapGet("/api/downloads/windows", () =>
    File.Exists(windowsInstaller) ? Results.File(windowsInstaller, "application/zip", Path.GetFileName(windowsInstaller)) : Results.NotFound());

// The interface language is a user setting, so notifications and the capture app follow it too.
app.MapPut("/api/me/lang", (LangRequest req, HttpContext ctx, Users users) =>
{
    if (!Strings.IsLang(req.Lang)) return Results.BadRequest();
    var key = users.Key(ctx.User);
    users.Save(key, users.Settings(key) with { Lang = req.Lang });
    return Results.NoContent();
});

app.MapPut("/api/me/notify", (NotifyRequest req, HttpContext ctx, Users users) =>
{
    var key = users.Key(ctx.User);
    users.Save(key, users.Settings(key) with { Notify = req.Enabled });
    return Results.NoContent();
});

app.MapPost("/api/me/token", (HttpContext ctx, Users users) => new { token = users.NewToken(users.Key(ctx.User)) });
// Only for the desktop app, with its token: a code to open the site signed in (see /login/app).
app.MapPost("/api/app/code", (HttpContext ctx) =>
    ctx.User.Identity?.AuthenticationType == "token" ? Results.Ok(new { code = AppCodes.New(ctx.User.FindFirstValue(ClaimTypes.Email)!) }) : Results.StatusCode(403));

// File icons: small PNGs (the client resizes uploads), named by their content hash.
app.MapPost("/api/icons", async (HttpContext ctx, Users users) =>
{
    using var buffer = new MemoryStream();
    await ctx.Request.Body.CopyToAsync(buffer);
    var png = buffer.ToArray();
    if (png.Length > 256 * 1024 || !png.AsSpan().StartsWith((byte[])[0x89, (byte)'P', (byte)'N', (byte)'G'])) return Results.BadRequest(Strings.Tr(ctx, "O ícone tem de ser um PNG até 256 KB"));
    var dir = users.IconsDir(users.Key(ctx.User));
    Directory.CreateDirectory(dir);
    var name = Convert.ToHexStringLower(SHA256.HashData(png))[..16] + ".png";
    await File.WriteAllBytesAsync(Path.Combine(dir, name), png);
    return Results.Ok(new { name });
});

app.MapGet("/api/icons/{name}", (string name, HttpContext ctx, Users users) =>
    IconName().IsMatch(name) && Path.Combine(users.IconsDir(users.Key(ctx.User)), name) is var file && File.Exists(file)
        ? Results.File(file, "image/png")
        : Results.NotFound());

// Images for notes, saved next to the note in `<note>_Artifacts/` (named by content hash) and linked as [[file:<note>_Artifacts/<name>]].
var imageTypes = new Dictionary<string, string> { [".png"] = "image/png", [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".gif"] = "image/gif", [".webp"] = "image/webp" };

app.MapPost("/api/images", async (string file, HttpContext ctx, Users users) =>
{
    if (users.For(ctx.User).ArtifactsFolder(file) is not { } folder) return Results.BadRequest(Strings.Tr(ctx, "Ficheiro inválido"));
    using var buffer = new MemoryStream();
    await ctx.Request.Body.CopyToAsync(buffer);
    var data = buffer.ToArray();
    // The extension comes from the content, never from the client.
    string? ext = data switch
    {
        [0x89, (byte)'P', (byte)'N', (byte)'G', ..] => ".png",
        [0xFF, 0xD8, 0xFF, ..] => ".jpg",
        [(byte)'G', (byte)'I', (byte)'F', ..] => ".gif",
        [(byte)'R', (byte)'I', (byte)'F', (byte)'F', _, _, _, _, (byte)'W', (byte)'E', (byte)'B', (byte)'P', ..] => ".webp",
        _ => null,
    };
    if (ext == null || data.Length > 10 * 1024 * 1024) return Results.BadRequest(Strings.Tr(ctx, "A imagem tem de ser PNG, JPEG, GIF ou WebP, até 10 MB"));
    var dir = Path.Combine(users.Root(users.Key(ctx.User)), folder);
    Directory.CreateDirectory(dir);
    var name = Convert.ToHexStringLower(SHA256.HashData(data))[..16] + ext;
    await File.WriteAllBytesAsync(Path.Combine(dir, name), data);
    return Results.Ok(new { path = $"{folder}/{name}" });
});

// Files attached to an entry, saved with the note's images in `<note>_Artifacts/` under their own name (made unique) and
// linked as [[file:<note>_Artifacts/<name>][<name>]].
const long maxAttachment = 100 * 1024 * 1024;
app.MapPost("/api/attachments", async (string file, string name, HttpContext ctx, Users users) =>
{
    if (users.For(ctx.User).ArtifactsFolder(file) is not { } folder) return Results.BadRequest(Strings.Tr(ctx, "Ficheiro inválido"));
    // Kestrel stops request bodies at 30 MB unless the endpoint says otherwise.
    if (ctx.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit) limit.MaxRequestBodySize = maxAttachment + 1;
    if (ctx.Request.ContentLength > maxAttachment) return Results.BadRequest(Strings.Tr(ctx, "O anexo pode ter até 100 MB"));
    // Only the file's own name, without folders or characters Windows or links can't take.
    var clean = string.Concat(Path.GetFileName(name.Replace('\\', '/')).Select(c => Path.GetInvalidFileNameChars().Contains(c) || "[]:*?\"<>|".Contains(c) ? '_' : c)).Trim().TrimStart('.');
    if (clean == "") clean = "anexo";
    var dir = Path.Combine(users.Root(users.Key(ctx.User)), folder);
    Directory.CreateDirectory(dir);
    var unique = Artifacts.Unique(dir, clean);
    var target = Path.Combine(dir, unique);
    try
    {
        await using (var output = File.Create(target))
        {
            var buffer = new byte[81920];
            long total = 0;
            int read;
            while ((read = await ctx.Request.Body.ReadAsync(buffer)) > 0)
            {
                if ((total += read) > maxAttachment) throw new InvalidDataException();
                await output.WriteAsync(buffer.AsMemory(0, read));
            }
        }
    }
    catch (InvalidDataException)
    {
        File.Delete(target);
        return Results.BadRequest(Strings.Tr(ctx, "O anexo pode ter até 100 MB"));
    }
    return Results.Ok(new { path = $"{folder}/{unique}", name = unique });
});

// Images and attached files linked from notes, by their path in the user's folder. Images and PDFs open in the browser;
// anything else is downloaded, so a page in an attachment never runs as part of the site.
var contentTypes = new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();
app.MapGet("/api/raw/{*path}", (string path, HttpContext ctx, Users users) =>
{
    var root = Path.GetFullPath(users.Root(users.Key(ctx.User)));
    var full = Path.GetFullPath(Path.Combine(root, path));
    if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal) || !File.Exists(full)) return Results.NotFound();
    var ext = Path.GetExtension(full).ToLowerInvariant();
    if (imageTypes.TryGetValue(ext, out var type)) return Results.File(full, type);
    if (ext == ".pdf") return Results.File(full, "application/pdf");
    if (!Artifacts.IsInside(full)) return Results.NotFound();
    return Results.File(full, contentTypes.TryGetContentType(full, out var t) && !t.Contains("html") && !t.Contains("svg") && !t.Contains("javascript") ? t : "application/octet-stream", Path.GetFileName(full));
});

app.MapGet("/api/capture/templates", (HttpContext ctx, Users users) =>
{
    var store = users.For(ctx.User);
    return store.List().SelectMany(f =>
    {
        var text = store.Read(f.Path) ?? "";
        var options = OrgCapture.FieldOptions(f.Path, text, store.Read);
        return OrgCapture.TemplatesIn(f.Path, text).Select(t => new
        {
            t.Key, t.Name, t.File, t.Datetree, t.UsesWhen, t.Props,
            Options = t.Props.Where(options.ContainsKey).ToDictionary(p => p, p => options[p]),
        });
    });
});

app.MapPost("/api/capture", (CaptureRequest req, HttpContext ctx, Users users) =>
{
    var store = users.For(ctx.User);
    var text = store.Read(req.File) ?? "";
    if (OrgCapture.TemplatesIn(req.File, text).FirstOrDefault(t => t.Key == req.Key) is not { } tpl) return Results.NotFound(Strings.Tr(ctx, "Template não encontrado"));
    if (string.IsNullOrWhiteSpace(req.Title)) return Results.BadRequest(Strings.Tr(ctx, "Falta o título"));
    // The client's local time, so %U and the datetree follow the user's clock rather than the server's.
    var now = req.Now ?? DateTime.Now;
    var entry = OrgCapture.Expand(tpl, req.Title.Trim(), req.Body ?? "", req.Date, req.Time, now, req.Props, req.Tags);
    store.Write(req.File, OrgCapture.CaptureInto(text, entry, tpl.Datetree, now));
    return Results.Ok(new { file = req.File });
});

app.MapPost("/api/ai/improve", async (ImproveRequest req, HttpContext ctx, AiAssistant ai, ILogger<AiAssistant> log, CancellationToken ct) =>
{
    if (!ai.Enabled) return Results.NotFound(Strings.Tr(ctx, "IA não configurada"));
    try { return Results.Ok(await ai.Improve(req.Fields, req.Mode ?? "develop", ct)); }
    catch (Exception e) when (AiAssistant.IsRateLimit(e)) { return Results.Problem(Strings.Tr(ctx, "Demasiados pedidos à IA; tenta daqui a pouco."), statusCode: 429); }
    catch (Exception e) when (e is AnthropicException or HttpRequestException or JsonException or KeyNotFoundException)
    {
        log.LogWarning(e, "AI request failed");
        return Results.Problem(Strings.Tr(ctx, "A IA falhou: {0}", AiAssistant.ProviderMessage(e)), statusCode: 502);
    }
    catch (InvalidOperationException e) { return Results.Problem(Strings.Tr(ctx, e.Message), statusCode: 502); }
});

// Items for the user's templates from free text (an email...), for the user to review before capturing them.
app.MapPost("/api/ai/extract", async (ExtractRequest req, HttpContext ctx, Users users, AiAssistant ai, Extraction extraction, ILogger<AiAssistant> log, CancellationToken ct) =>
{
    if (!ai.Enabled) return Results.NotFound(Strings.Tr(ctx, "IA não configurada"));
    if (string.IsNullOrWhiteSpace(req.Text)) return Results.BadRequest(Strings.Tr(ctx, "Falta o texto"));
    try { return Results.Ok(await extraction.Run(users.For(ctx.User), req.Text, req.Now ?? DateTime.Now, Strings.Of(ctx), ct)); }
    catch (Exception e) when (AiAssistant.IsRateLimit(e)) { return Results.Problem(Strings.Tr(ctx, "Demasiados pedidos à IA; tenta daqui a pouco."), statusCode: 429); }
    catch (Exception e) when (e is AnthropicException or HttpRequestException or JsonException or KeyNotFoundException)
    {
        log.LogWarning(e, "AI request failed");
        return Results.Problem(Strings.Tr(ctx, "A IA falhou: {0}", AiAssistant.ProviderMessage(e)), statusCode: 502);
    }
    catch (InvalidOperationException e) { return Results.Problem(Strings.Tr(ctx, e.Message), statusCode: 502); }
});

app.MapPost("/api/ai/template", async (TemplateRequest req, HttpContext ctx, AiAssistant ai, ILogger<AiAssistant> log, CancellationToken ct) =>
{
    if (!ai.Enabled) return Results.NotFound(Strings.Tr(ctx, "IA não configurada"));
    if (string.IsNullOrWhiteSpace(req.Description)) return Results.BadRequest(Strings.Tr(ctx, "Falta a descrição"));
    try { return Results.Ok(await ai.Template(req.Description, ct)); }
    catch (Exception e) when (AiAssistant.IsRateLimit(e)) { return Results.Problem(Strings.Tr(ctx, "Demasiados pedidos à IA; tenta daqui a pouco."), statusCode: 429); }
    catch (Exception e) when (e is AnthropicException or HttpRequestException or JsonException or KeyNotFoundException)
    {
        log.LogWarning(e, "AI request failed");
        return Results.Problem(Strings.Tr(ctx, "A IA falhou: {0}", AiAssistant.ProviderMessage(e)), statusCode: 502);
    }
    catch (InvalidOperationException e) { return Results.Problem(Strings.Tr(ctx, e.Message), statusCode: 502); }
});

app.MapFallbackToFile("index.html", staticOptions);

app.Run();

record RenameRequest(string From, string To);
record FolderRequest(string Path);

partial class Program
{
    [GeneratedRegex(@"^[0-9a-f]{16}\.png$")] private static partial Regex IconName();
}
record NotifyRequest(bool Enabled);
record ImproveRequest(Dictionary<string, string> Fields, string? Mode);
record TemplateRequest(string Description);
record LangRequest(string Lang);
record LoginRequest(string Email);
record ExtractRequest(string Text, DateTime? Now);
record MailRequest(string Host, int Port, string User, string? Password, string Folder, bool Enabled);
record CaptureRequest(string File, string Key, string Title, string? Body, DateOnly? Date, TimeOnly? Time, DateTime? Now, Dictionary<string, string>? Props, string[]? Tags);
