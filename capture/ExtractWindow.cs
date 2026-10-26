using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace OrgNotes.Capture;

/// <summary>
/// Same flow as the web's "Do texto (IA)": paste an email or other text, let the server's AI propose items for the
/// user's templates, review them (untick, change the template, title, date, fields, notes) and create them.
/// </summary>
public class ExtractWindow : Window
{
    private readonly Api _api;
    private readonly TextBox _text = new()
    {
        PlaceholderText = L.Tr("Cola aqui o texto…"),
        AcceptsReturn = true,
        TextWrapping = TextWrapping.Wrap,
        Height = 260,
    };
    private readonly Button _analyse = new() { Content = L.Tr("Analisar"), Classes = { "accent" } };
    private readonly Button _create = new() { Classes = { "accent" }, IsVisible = false };
    private readonly Button _back = new() { Content = L.Tr("Voltar"), IsVisible = false };
    private readonly TextBlock _status = new() { Opacity = 0.7, TextWrapping = TextWrapping.Wrap };
    private readonly StackPanel _items = new() { Spacing = 10 };
    private readonly ScrollViewer _review = new() { MaxHeight = 560, IsVisible = false };
    private List<Template> _templates = [];
    private readonly List<Row> _rows = [];

    /// <summary>One proposed item's controls; its fields are rebuilt when the template changes.</summary>
    private sealed class Row
    {
        public required CheckBox Keep;
        public required ComboBox TemplateBox;
        public required TextBox Title;
        public required CalendarDatePicker Date;
        public required TextBox Time;
        public required Grid When;
        public required StackPanel Fields;
        public required TextBox Body;
    }

    public ExtractWindow(Api api, string initialText = "")
    {
        _api = api;
        Title = L.Tr("Criar a partir de texto (IA)");
        Width = 640;
        SizeToContent = SizeToContent.Height;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        _text.Text = initialText;
        _review.Content = _items;

        var cancel = new Button { Content = L.Tr("Cancelar") };
        cancel.Click += (_, _) => Close();
        _analyse.Click += async (_, _) => await Analyse();
        _back.Click += (_, _) => ShowStep(review: false);
        _create.Click += async (_, _) => await Create();
        Content = new StackPanel
        {
            Margin = new Thickness(16),
            Spacing = 10,
            Children =
            {
                new TextBlock
                {
                    Text = L.Tr("Cola um email ou outro texto: a IA propõe tarefas, eventos e contactos com os teus templates, e tu revês antes de criar."),
                    TextWrapping = TextWrapping.Wrap,
                    Opacity = 0.7,
                },
                _text,
                _review,
                _status,
                new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Spacing = 8, Children = { cancel, _back, _analyse, _create } },
            },
        };
    }

    private void ShowStep(bool review)
    {
        _text.IsVisible = _analyse.IsVisible = !review;
        _review.IsVisible = _back.IsVisible = _create.IsVisible = review;
    }

    private async Task Analyse()
    {
        if (string.IsNullOrWhiteSpace(_text.Text)) return;
        _analyse.IsEnabled = false;
        _status.Text = L.Tr("A analisar…");
        try
        {
            _templates = await _api.Templates();
            var items = await _api.Extract(_text.Text);
            _items.Children.Clear();
            _rows.Clear();
            foreach (var it in items) AddRow(it);
            _status.Text = items.Count == 0 ? L.Tr("A IA não encontrou nada para criar neste texto.") : "";
            UpdateCreate();
            if (items.Count > 0) ShowStep(review: true);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            _status.Text = e.Message;
        }
        finally
        {
            _analyse.IsEnabled = true;
        }
    }

    private void AddRow(ProposedItem it)
    {
        var row = new Row
        {
            Keep = new CheckBox { IsChecked = true },
            TemplateBox = new ComboBox { ItemsSource = _templates.Select(t => $"{t.Name} → {t.File}").ToList(), MinWidth = 180 },
            Title = new TextBox { Text = it.Title },
            Date = new CalendarDatePicker { HorizontalAlignment = HorizontalAlignment.Stretch, PlaceholderText = L.Tr("Data") },
            Time = new TextBox { PlaceholderText = L.Tr("Hora (HH:MM)"), Width = 130, Text = it.Time },
            When = new Grid { ColumnDefinitions = new("*,Auto"), ColumnSpacing = 8 },
            Fields = new StackPanel { Spacing = 6 },
            Body = new TextBox { Text = it.Body, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 50 },
        };
        if (DateOnly.TryParse(it.Date, out var d)) row.Date.SelectedDate = d.ToDateTime(TimeOnly.MinValue);
        row.When.Children.Add(row.Date);
        Grid.SetColumn(row.Time, 1);
        row.When.Children.Add(row.Time);
        var head = new Grid { ColumnDefinitions = new("Auto,Auto,*"), ColumnSpacing = 8 };
        head.Children.Add(row.Keep);
        Grid.SetColumn(row.TemplateBox, 1);
        head.Children.Add(row.TemplateBox);
        Grid.SetColumn(row.Title, 2);
        head.Children.Add(row.Title);
        var panel = new StackPanel { Spacing = 6, Children = { head, row.When, row.Fields, row.Body } };
        _items.Children.Add(new Border { BorderBrush = Brushes.Gray, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(6), Padding = new Thickness(8), Child = panel });
        _rows.Add(row);

        row.Keep.IsCheckedChanged += (_, _) =>
        {
            panel.Opacity = row.Keep.IsChecked == true ? 1 : 0.5;
            UpdateCreate();
        };
        row.TemplateBox.SelectionChanged += (_, _) => ShowFields(row, it.Props);
        row.TemplateBox.SelectedIndex = _templates.FindIndex(t => t.File == it.File && t.Key == it.Key);
    }

    /// <summary>The template's date and fields, keeping what was already typed (or proposed) under the same names.</summary>
    private void ShowFields(Row row, Dictionary<string, string> proposed)
    {
        var typed = row.Fields.Children.OfType<StackPanel>().ToDictionary(p => (string)p.Tag!, p => FieldText(p.Children[1]));
        row.Fields.Children.Clear();
        var t = row.TemplateBox.SelectedIndex >= 0 ? _templates[row.TemplateBox.SelectedIndex] : null;
        row.When.IsVisible = t?.UsesWhen == true;
        foreach (var p in t?.Props ?? [])
        {
            var value = typed.GetValueOrDefault(p) ?? proposed.GetValueOrDefault(p) ?? "";
            Control box = t!.Options?.GetValueOrDefault(p) is { } options
                ? new AutoCompleteBox { Text = value, ItemsSource = options, MinimumPrefixLength = 0, FilterMode = AutoCompleteFilterMode.Contains }
                : new TextBox { Text = value };
            row.Fields.Children.Add(new StackPanel { Tag = p, Spacing = 2, Children = { new TextBlock { Text = p[..1] + p[1..].ToLowerInvariant(), Opacity = 0.7 }, box } });
        }
    }

    private static string FieldText(Control c) => (c as TextBox)?.Text ?? (c as AutoCompleteBox)?.Text ?? "";

    private void UpdateCreate()
    {
        var n = _rows.Count(r => r.Keep.IsChecked == true);
        _create.Content = L.Tr("Criar {0} itens", n);
        _create.IsEnabled = n > 0;
    }

    private async Task Create()
    {
        _create.IsEnabled = false;
        try
        {
            foreach (var r in _rows.Where(r => r.Keep.IsChecked == true && r.TemplateBox.SelectedIndex >= 0 && !string.IsNullOrWhiteSpace(r.Title.Text)))
            {
                var t = _templates[r.TemplateBox.SelectedIndex];
                DateOnly? date = t.UsesWhen && r.Date.SelectedDate is { } d ? DateOnly.FromDateTime(d) : null;
                TimeOnly? time = date != null && TimeOnly.TryParse(r.Time.Text, out var tm) ? tm : null;
                var props = r.Fields.Children.OfType<StackPanel>().ToDictionary(p => (string)p.Tag!, p => FieldText(p.Children[1]));
                await _api.Capture(t, r.Title.Text!.Trim(), r.Body.Text ?? "", date, time, props);
            }
            Close();
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            _status.Text = e.Message;
            _create.IsEnabled = true;
        }
    }
}
