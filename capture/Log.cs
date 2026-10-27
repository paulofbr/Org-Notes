namespace OrgNotes.Capture;

/// <summary>Errors worth sending when something fails on the user's machine, in erros.log in the config folder.</summary>
public static class Log
{
    public static string FilePath => Path.Combine(Config.Dir, "erros.log");

    public static void Write(string message)
    {
        try
        {
            Directory.CreateDirectory(Config.Dir);
            File.AppendAllText(FilePath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} v{Updater.Version ?? "dev"} {message}{Environment.NewLine}");
        }
        catch (IOException)
        {
            // Nowhere to write: nothing more to do.
        }
    }
}
