using System.Text.Json;

namespace OrgNotes.Capture;

/// <summary>Settings kept in the user's config folder (~/.config/orgnotes or %APPDATA%\orgnotes).</summary>
public class Config
{
    public string Server { get; set; } = "http://localhost:5080";
    public string Token { get; set; } = "";
    /// <summary>Global shortcut registered by the app on Windows. On Linux the desktop binds a key to `--show`.</summary>
    public string Hotkey { get; set; } = "Win+Alt+C";
    /// <summary>UI scale on Linux/X11 (0 = take each monitor's scale from Hyprland).</summary>
    public double Scale { get; set; }

    public static string Dir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "orgnotes");
    private static string FilePath => Path.Combine(Dir, "capture.json");

    public static bool Exists => File.Exists(FilePath);

    public static Config Load()
    {
        try
        {
            return File.Exists(FilePath) ? JsonSerializer.Deserialize<Config>(File.ReadAllText(FilePath)) ?? new() : new();
        }
        catch (JsonException)
        {
            return new();
        }
    }

    public void Save()
    {
        Directory.CreateDirectory(Dir);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        // The token gives access to the user's notes.
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(FilePath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
    }
}
