using OrgNotes.Server;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var root = Path.GetFullPath(builder.Configuration["OrgDirectory"] ?? "data", builder.Environment.ContentRootPath);
var store = new OrgStore(root);
store.SeedIfEmpty(Path.Combine(AppContext.BaseDirectory, "Seed"));
app.Logger.LogInformation("Org directory: {Root}", root);

app.UseDefaultFiles();
app.UseStaticFiles();

var files = app.MapGroup("/api/files");

files.MapGet("/", () => store.List());

files.MapGet("/{*path}", (string path) =>
    store.Read(path) is { } text ? Results.Text(text, "text/plain; charset=utf-8") : Results.NotFound());

files.MapPut("/{*path}", async (string path, HttpRequest request) =>
{
    using var reader = new StreamReader(request.Body);
    var text = await reader.ReadToEndAsync();
    return store.Write(path, text) is { } info ? Results.Ok(info) : Results.BadRequest("Invalid path");
});

files.MapDelete("/{*path}", (string path) => store.Delete(path) ? Results.NoContent() : Results.NotFound());

app.MapPost("/api/rename", (RenameRequest req) =>
    store.Rename(req.From, req.To) ? Results.NoContent() : Results.BadRequest("Cannot rename"));

app.MapFallbackToFile("index.html");

app.Run();

record RenameRequest(string From, string To);
