namespace OrgNotes.Server;

public record OrgFileInfo(string Path, long Size, DateTime Modified);

/// <summary>Stores .org files in a directory. All paths are relative to the root and must end in .org.</summary>
public class OrgStore(string root)
{
    private readonly string _root = Path.GetFullPath(root);

    public void SeedIfEmpty(string seedDir)
    {
        Directory.CreateDirectory(_root);
        if (Directory.EnumerateFiles(_root, "*.org", SearchOption.AllDirectories).Any() || !Directory.Exists(seedDir)) return;
        foreach (var file in Directory.GetFiles(seedDir, "*.org"))
            File.Copy(file, Path.Combine(_root, Path.GetFileName(file)));
    }

    public IEnumerable<OrgFileInfo> List() =>
        Directory.EnumerateFiles(_root, "*.org", SearchOption.AllDirectories)
            .Select(Info)
            .OrderBy(f => f.Path, StringComparer.OrdinalIgnoreCase);

    public string? Read(string path) =>
        Resolve(path) is { } full && File.Exists(full) ? File.ReadAllText(full) : null;

    public OrgFileInfo? Write(string path, string text)
    {
        if (Resolve(path) is not { } full) return null;
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, text);
        return Info(full);
    }

    public bool Delete(string path)
    {
        if (Resolve(path) is not { } full || !File.Exists(full)) return false;
        File.Delete(full);
        return true;
    }

    public bool Rename(string from, string to)
    {
        if (Resolve(from) is not { } src || Resolve(to) is not { } dst || !File.Exists(src) || File.Exists(dst)) return false;
        Directory.CreateDirectory(Path.GetDirectoryName(dst)!);
        File.Move(src, dst);
        return true;
    }

    private OrgFileInfo Info(string full)
    {
        var fi = new FileInfo(full);
        return new OrgFileInfo(Path.GetRelativePath(_root, full).Replace('\\', '/'), fi.Length, fi.LastWriteTimeUtc);
    }

    /// <summary>Maps a relative path to an absolute one inside the root, or null if it escapes the root or is not .org.</summary>
    private string? Resolve(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !path.EndsWith(".org", StringComparison.OrdinalIgnoreCase)) return null;
        var full = Path.GetFullPath(Path.Combine(_root, path));
        return full.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.Ordinal) ? full : null;
    }
}
