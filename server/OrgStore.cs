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

    /// <summary>All folders, including empty ones; hidden ones (like `.icons`) are left out.</summary>
    public IEnumerable<string> Folders() =>
        Directory.Exists(_root)
            ? Directory.EnumerateDirectories(_root, "*", SearchOption.AllDirectories)
                .Select(d => Path.GetRelativePath(_root, d).Replace('\\', '/'))
                .Where(d => !d.Split('/').Any(s => s.StartsWith('.')) && !IsImagesFolder(d))
                .Order(StringComparer.OrdinalIgnoreCase)
            : [];

    /// <summary>The folder for a note's images, next to it: `projetos/plano.org` → `projetos/plano_images`.</summary>
    public string? ImagesFolder(string orgPath) => Resolve(orgPath) is null ? null : orgPath[..^4] + "_images";

    /// <summary>A note's images folder belongs with the note, so it is not listed as a folder of its own.</summary>
    private bool IsImagesFolder(string folder) =>
        folder.EndsWith("_images", StringComparison.Ordinal) && File.Exists(Path.Combine(_root, folder[..^7] + ".org"));

    public bool CreateFolder(string path)
    {
        if (ResolveFolder(path) is not { } full) return false;
        Directory.CreateDirectory(full);
        return true;
    }

    /// <summary>Deletes a folder only when no file is left in it, so no notes can be lost this way.</summary>
    public bool DeleteFolder(string path)
    {
        if (ResolveFolder(path) is not { } full || !Directory.Exists(full) || Directory.EnumerateFiles(full, "*", SearchOption.AllDirectories).Any()) return false;
        Directory.Delete(full, true);
        return true;
    }

    private string? ResolveFolder(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Split('/', '\\').Any(s => s.StartsWith('.') || s.Trim() == "")) return null;
        var full = Path.GetFullPath(Path.Combine(_root, path));
        return full.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.Ordinal) ? full : null;
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
