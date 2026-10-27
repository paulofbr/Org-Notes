namespace OrgNotes.Server;

/// <summary>
/// A note's images and attached files live in one folder next to it: `projetos/plano.org` → `projetos/plano_Artifacts`.
/// Earlier versions kept them in `plano_images` and `plano_attachments`; <see cref="Migrate"/> moves those in.
/// </summary>
public static class Artifacts
{
    public const string Suffix = "_Artifacts";
    private static readonly string[] OldSuffixes = ["_images", "_attachments"];

    /// <summary>The folder for a note's images and attachments, relative to the user's root.</summary>
    public static string FolderOf(string orgPath) => orgPath[..^4] + Suffix;

    /// <summary>Whether a folder is a note's own (its artifacts, or an old images/attachments one), not listed on its own.</summary>
    public static bool IsNoteFolder(string root, string folder) =>
        OldSuffixes.Append(Suffix).Any(suffix =>
            folder.EndsWith(suffix, StringComparison.Ordinal) && File.Exists(Path.Combine(root, folder[..^suffix.Length] + ".org")));

    /// <summary>Whether a path (in the user's folder) is inside some note's artifacts folder, old or new.</summary>
    public static bool IsInside(string path) =>
        OldSuffixes.Append(Suffix).Any(suffix => path.Contains(suffix + Path.DirectorySeparatorChar, StringComparison.Ordinal));

    /// <summary>
    /// Moves every note's `_images` and `_attachments` files into its `_Artifacts` folder and points the note's links
    /// there. A name already taken there gets a " (2)" before its extension, and that link is changed to match.
    /// </summary>
    public static void Migrate(string root, Action<string>? log = null)
    {
        if (!Directory.Exists(root)) return;
        foreach (var note in Directory.EnumerateFiles(root, "*.org", SearchOption.AllDirectories))
        {
            if (Path.GetRelativePath(root, note).Split(Path.DirectorySeparatorChar).Any(s => s.StartsWith('.'))) continue;
            try
            {
                MigrateNote(note);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                log?.Invoke($"Não foi possível mover os anexos de {note}: {e.Message}");
            }
        }
    }

    private static void MigrateNote(string note)
    {
        var stem = note[..^4];
        var name = Path.GetFileName(stem);
        var target = stem + Suffix;
        var renames = new List<(string From, string To)>();
        var moved = false;
        foreach (var suffix in OldSuffixes)
        {
            var old = stem + suffix;
            if (!Directory.Exists(old)) continue;
            Directory.CreateDirectory(target);
            foreach (var file in Directory.EnumerateFiles(old))
            {
                var fileName = Path.GetFileName(file);
                var dest = Unique(target, fileName);
                File.Move(file, Path.Combine(target, dest));
                renames.Add(($"{name}{suffix}/{fileName}", $"{name}{Suffix}/{dest}"));
            }
            if (!Directory.EnumerateFileSystemEntries(old).Any()) Directory.Delete(old);
            moved = true;
        }
        if (!moved) return;
        var text = File.ReadAllText(note);
        var updated = text;
        // Each moved file's links (renamed ones included); the folder alone covers links written another way.
        foreach (var (from, to) in renames) updated = updated.Replace(from, to, StringComparison.Ordinal);
        foreach (var suffix in OldSuffixes) updated = updated.Replace($"{name}{suffix}/", $"{name}{Suffix}/", StringComparison.Ordinal);
        if (updated != text) File.WriteAllText(note, updated);
    }

    /// <summary>A file name not yet taken in `dir`: the name itself, or "name (2).ext", "name (3).ext"…</summary>
    public static string Unique(string dir, string fileName)
    {
        var (stem, ext) = (Path.GetFileNameWithoutExtension(fileName), Path.GetExtension(fileName));
        var unique = fileName;
        for (var n = 2; File.Exists(Path.Combine(dir, unique)); n++) unique = $"{stem} ({n}){ext}";
        return unique;
    }
}
