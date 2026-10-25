using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Layout;
using Avalonia.Media;

namespace OrgNotes.Capture;

/// <summary>Shows AI suggestions as a word-level diff per field, with Aceitar / Descartar, like the web version.</summary>
public class AiReviewPanel : Border
{
    public event Action<Dictionary<string, string>>? Accepted;

    public AiReviewPanel()
    {
        BorderThickness = new Thickness(1);
        BorderBrush = new SolidColorBrush(Colors.Gray, 0.5);
        CornerRadius = new CornerRadius(8);
        Padding = new Thickness(10, 8);
        IsVisible = false;
    }

    public void ShowMessage(string text)
    {
        Child = new TextBlock { Text = text, Opacity = 0.75, TextWrapping = TextWrapping.Wrap };
        IsVisible = true;
    }

    public void ShowResult(Dictionary<string, string> original, Improved result, Dictionary<string, string> labels)
    {
        var changed = original.Keys.Where(k => result.Fields.GetValueOrDefault(k, original[k]) != original[k]).ToList();
        var stack = new StackPanel { Spacing = 6 };
        if (changed.Count == 0) stack.Children.Add(new TextBlock { Text = "Sem sugestões: o texto parece estar bem.", Opacity = 0.75 });
        foreach (var k in changed)
        {
            stack.Children.Add(new TextBlock { Text = labels.GetValueOrDefault(k, k), Opacity = 0.6, FontSize = 12 });
            var text = new SelectableTextBlock { TextWrapping = TextWrapping.Wrap, FontFamily = new FontFamily("monospace"), Inlines = [] };
            foreach (var (part, op) in DiffWords(original[k], result.Fields[k]))
                text.Inlines!.Add(op switch
                {
                    '-' => new Run(part) { Foreground = Brushes.IndianRed, TextDecorations = TextDecorations.Strikethrough },
                    '+' => new Run(part) { Foreground = Brushes.MediumPurple, FontWeight = FontWeight.SemiBold },
                    _ => new Run(part),
                });
            stack.Children.Add(text);
        }
        foreach (var c in result.Changes) stack.Children.Add(new TextBlock { Text = "• " + c, Opacity = 0.75, TextWrapping = TextWrapping.Wrap, FontSize = 12 });

        var discard = new Button { Content = "Descartar" };
        discard.Click += (_, _) => IsVisible = false;
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Spacing = 8, Children = { discard } };
        if (changed.Count > 0)
        {
            var accept = new Button { Content = "Aceitar", Classes = { "accent" } };
            accept.Click += (_, _) =>
            {
                IsVisible = false;
                Accepted?.Invoke(result.Fields);
            };
            buttons.Children.Add(accept);
        }
        stack.Children.Add(buttons);
        Child = stack;
        IsVisible = true;
    }

    /// <summary>Word-level diff (LCS); same algorithm as the web's diffWords. Ops: '=', '-', '+'.</summary>
    public static List<(string Text, char Op)> DiffWords(string a, string b)
    {
        string[] x = System.Text.RegularExpressions.Regex.Split(a, @"(\s+)"), y = System.Text.RegularExpressions.Regex.Split(b, @"(\s+)");
        var lcs = new int[x.Length + 1, y.Length + 1];
        for (var i = x.Length - 1; i >= 0; i--)
            for (var j = y.Length - 1; j >= 0; j--)
                lcs[i, j] = x[i] == y[j] ? lcs[i + 1, j + 1] + 1 : Math.Max(lcs[i + 1, j], lcs[i, j + 1]);
        var out_ = new List<(string Text, char Op)>();
        void Push(string t, char op)
        {
            if (out_.Count > 0 && out_[^1].Op == op) out_[^1] = (out_[^1].Text + t, op);
            else out_.Add((t, op));
        }
        int p = 0, q = 0;
        while (p < x.Length || q < y.Length)
        {
            if (p < x.Length && q < y.Length && x[p] == y[q])
            {
                Push(x[p], '=');
                (p, q) = (p + 1, q + 1);
            }
            else if (p < x.Length && (q == y.Length || lcs[p + 1, q] >= lcs[p, q + 1])) Push(x[p++], '-');
            else Push(y[q++], '+');
        }
        return out_;
    }
}
