using System.Text.RegularExpressions;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Layout;

namespace OrgNotes.Capture;

/// <summary>
/// Picks a new item's tags, as the web's tag picker: the tags already in use as buttons to switch on, and a box for
/// new ones (separated by spaces or commas).
/// </summary>
public partial class TagPicker : StackPanel
{
    private readonly WrapPanel _known = new();
    private readonly TextBox _new = new() { PlaceholderText = L.Tr("Novas etiquetas (separadas por espaços)") };

    public TagPicker()
    {
        Spacing = 4;
        Children.Add(new TextBlock { Text = L.Tr("Etiquetas"), Opacity = 0.7 });
        Children.Add(new ScrollViewer { MaxHeight = 96, Content = _known });
        Children.Add(_new);
    }

    [GeneratedRegex(@"[^\p{L}\p{N}_@#%]")] private static partial Regex InvalidRe();

    /// <summary>A tag as org accepts it: letters, digits, _ @ # %. Same as the web's cleanTag.</summary>
    private static string Clean(string tag) => InvalidRe().Replace(tag.Trim(), "");

    /// <summary>The tags in use, to offer as buttons; the chosen ones stay chosen.</summary>
    public void SetKnown(IEnumerable<string> tags)
    {
        var chosen = Tags;
        _known.Children.Clear();
        foreach (var t in tags)
            _known.Children.Add(new ToggleButton { Content = t, Tag = t, Padding = new Thickness(8, 2), Margin = new Thickness(0, 0, 4, 4), FontSize = 12 });
        Tags = chosen;
    }

    public List<string> Tags
    {
        get => _known.Children.OfType<ToggleButton>().Where(b => b.IsChecked == true).Select(b => (string)b.Tag!)
            .Concat((_new.Text ?? "").Split([' ', ',', ';'], StringSplitOptions.RemoveEmptyEntries).Select(Clean))
            .Where(t => t != "").Distinct().ToList();
        set
        {
            var buttons = _known.Children.OfType<ToggleButton>().ToList();
            foreach (var b in buttons) b.IsChecked = value.Contains((string)b.Tag!);
            _new.Text = string.Join(' ', value.Where(t => buttons.All(b => (string)b.Tag! != t)));
        }
    }
}
