using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;

namespace OrgNotes.Capture;

/// <summary>
/// Same flow as the web capture dialog: press a template's key (or Enter for the selected one), type the title,
/// optional date/time and notes, Ctrl+Enter saves, Esc hides.
/// </summary>
public class CaptureWindow : Window
{
    private readonly Api _api;
    private readonly ComboBox _templates = new() { HorizontalAlignment = HorizontalAlignment.Stretch, PlaceholderText = L.Tr("Ficheiro") };
    private readonly TextBox _title = new() { PlaceholderText = L.Tr("Título") };
    // One box per empty property of the selected template, like the web dialog.
    private readonly StackPanel _props = new() { Spacing = 10 };
    private readonly TagPicker _tags = new();
    private readonly CalendarDatePicker _date = new() { PlaceholderText = L.Tr("Data"), HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly TextBox _time = new() { PlaceholderText = L.Tr("Hora (HH:MM)"), Width = 130 };
    private readonly Grid _when = new() { ColumnDefinitions = new("*,Auto"), ColumnSpacing = 8 };
    private readonly TextBox _body = new()
    {
        PlaceholderText = L.Tr("Notas (opcional, sintaxe org)"),
        AcceptsReturn = true,
        TextWrapping = TextWrapping.Wrap,
        Height = 120,
        FontFamily = new FontFamily("monospace"),
    };
    private readonly TextBlock _status = new() { Opacity = 0.7, TextWrapping = TextWrapping.Wrap };
    // Links and images, as the web editor's tools: a link goes where the cursor was in the title or the notes.
    private readonly TextBox _linkText = new() { PlaceholderText = L.Tr("Texto (opcional)") };
    // Internal links search the notes' files and headlines, as the web's link dialog does.
    private readonly Button _fromText = new() { Content = L.Tr("Do texto (IA)"), IsVisible = false };
    private readonly TextBox _linkSearch = new() { PlaceholderText = L.Tr("Procurar ficheiro ou título") };
    // The matches stay listed under the search, to click or to pick with the arrows and Enter.
    private readonly ListBox _linkList = new() { MaxHeight = 220 };
    private Dictionary<string, (string File, string? Heading)> _internal = [];
    private readonly StackPanel _linkPanel = new() { Spacing = 6, IsVisible = false };
    private TextBox _linkTarget;
    private (int Start, int End) _linkAt;
    private readonly Button _save = new() { Content = L.Tr("Guardar (Ctrl+Enter)"), IsDefault = false, Classes = { "accent" } };
    // Four-point sparkle, like the web's AI button.
    private readonly Button _ai = new()
    {
        Content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            Children =
            {
                new PathIcon { Data = Geometry.Parse("M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z"), Width = 16, Height = 16 },
                new TextBlock { Text = "▾", VerticalAlignment = VerticalAlignment.Center },
            },
        },
        IsVisible = false,
    };

    // Same modes as the web; ids match the server's AiAssistant.Modes.
    private readonly (string Id, string Label, string? Gesture)[] AiModes =
    [
        ("develop", L.Tr("Desenvolver"), "Alt+R"),
        ("fix", L.Tr("Corrigir"), "Alt+Shift+R"),
        ("summarize", L.Tr("Resumir"), null),
        ("formal", L.Tr("Tom profissional"), null),
        ("tasks", L.Tr("Extrair tarefas"), null),
    ];
    private readonly AiReviewPanel _aiPanel = new();
    private List<Template> _list = [];
    private bool _discarded;

    /// <summary>Raised when the server says the user's language differs from the one this window was built in.</summary>
    public event Action<string>? LanguageChanged;
    private Template? _selected;

    public CaptureWindow(Api api)
    {
        _api = api;
        Title = L.Tr("Capturar · Org Notes");
        Width = 560;
        SizeToContent = SizeToContent.Height;
        CanResize = false;
        Topmost = true;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;

        _linkTarget = _body;
        _title.GotFocus += (_, _) => _linkTarget = _title;
        _body.GotFocus += (_, _) => _linkTarget = _body;
        _body.TextChanged += async (_, _) => await RefreshImages();
        var insertLink = new Button { Content = L.Tr("Inserir") };
        insertLink.Click += (_, _) => InsertLink();
        Grid.SetColumn(_linkText, 1);
        Grid.SetColumn(insertLink, 2);
        _linkPanel.Children.Add(new Grid { ColumnDefinitions = new("2*,*,Auto"), ColumnSpacing = 8, Children = { _linkSearch, _linkText, insertLink } });
        _linkPanel.Children.Add(_linkList);
        _linkSearch.TextChanged += (_, _) => FilterLinks();
        _linkList.DoubleTapped += (_, _) => InsertLink();
        // The same three tools as the web editor.
        // A pasted web address becomes a link by itself, so only internal links need a button.
        _title.PastingFromClipboard += async (_, e) => await Paste(_title, e);
        _body.PastingFromClipboard += async (_, e) => await Paste(_body, e);
        var internalLink = new Button { Content = L.Tr("Link interno") };
        ToolTip.SetTip(internalLink, L.Tr("Link para um ficheiro ou título das notas") + " (Ctrl+L)");
        internalLink.Click += async (_, _) => await OpenLink();
        // Images come in from a file picker, or by pasting or dropping them on the notes, as on the web.
        var image = new Button { Content = L.Tr("Imagem") };
        image.Click += async (_, _) =>
        {
            var picked = await StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
            {
                AllowMultiple = true,
                FileTypeFilter = [new FilePickerFileType(L.Tr("Imagens")) { Patterns = ["*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp"] }],
            });
            await InsertImages(picked);
        };
        DragDrop.SetAllowDrop(_body, true);
        _body.AddHandler(DragDrop.DragOverEvent, (_, e) => e.DragEffects = e.DataTransfer.Contains(DataFormat.File) ? DragDropEffects.Copy : e.DragEffects, handledEventsToo: true);
        _body.AddHandler(DragDrop.DropEvent, async (_, e) =>
        {
            if (e.DataTransfer.TryGetFiles() is not { Length: > 0 } files) return;
            e.Handled = true;
            await InsertImages(files);
        }, handledEventsToo: true);
        ToolTip.SetTip(_fromText, L.Tr("Criar tarefas, eventos e contactos a partir de um email ou outro texto"));
        _fromText.Click += (_, _) => { new ExtractWindow(_api, _body.Text ?? "") { Icon = Icon }.Show(); Hide(); };
        var tools = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { internalLink, image, _fromText, new TextBlock { Text = L.Tr("ou cola / arrasta uma imagem para as notas"), Opacity = 0.6, VerticalAlignment = VerticalAlignment.Center } } };
        _when.Children.Add(_date);
        Grid.SetColumn(_time, 1);
        _when.Children.Add(_time);
        var cancel = new Button { Content = L.Tr("Cancelar") };
        cancel.Click += (_, _) => Hide();
        _save.Click += async (_, _) => await Save();
        ToolTip.SetTip(_ai, L.Tr("IA: desenvolver, corrigir, resumir… (Alt+R)"));
        var flyout = new MenuFlyout { Placement = PlacementMode.TopEdgeAlignedLeft };
        foreach (var (id, label, gesture) in AiModes)
        {
            var item = new MenuItem { Header = label, InputGesture = gesture is null ? null : KeyGesture.Parse(gesture) };
            item.Click += async (_, _) => await Review(id);
            flyout.Items.Add(item);
        }
        _ai.Flyout = flyout;
        _aiPanel.Accepted += f =>
        {
            _title.Text = f["title"];
            _body.Text = f["body"];
        };
        var actions = new Grid { ColumnDefinitions = new("Auto,*,Auto") };
        actions.Children.Add(_ai);
        var right = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        Grid.SetColumn(right, 2);
        actions.Children.Add(right);
        _templates.SelectionChanged += (_, _) => Select(_templates.SelectedIndex >= 0 ? _list[_templates.SelectedIndex] : null);
        Content = new StackPanel
        {
            Margin = new Thickness(16),
            Spacing = 10,
            Children =
            {
                _templates,
                new TextBlock { Text = L.Tr("Escolhe o ficheiro na lista (↑ ↓) ou pela tecla do template; Enter passa ao título."), Opacity = 0.6, FontSize = 12 },
                _title,
                _props,
                _tags,
                _when,
                _body,
                tools,
                _images,
                _linkPanel,
                _status,
                _aiPanel,
                actions,
            },
        };

        // Hide instead of closing so the next capture opens instantly.
        Closing += (_, e) =>
        {
            if (_discarded) return;
            e.Cancel = true;
            Hide();
        };
        right.Children.Add(cancel);
        right.Children.Add(_save);
        AddHandler(KeyDownEvent, OnKey, Avalonia.Interactivity.RoutingStrategies.Tunnel);
    }

    public async void ShowForCapture()
    {
        _title.Text = _body.Text = _time.Text = "";
        _imageData.Clear();
        _tags.Tags = [];
        _date.SelectedDate = null;
        _aiPanel.IsVisible = false;
        _status.Text = L.Tr("A carregar templates…");
        Show();
        Activate();
        _templates.Focus();
        try
        {
            _list = await _api.Templates();
            _tags.SetKnown(await _api.Tags());
            var me = await _api.Me();
            if (L.Langs.Contains(me.Lang) && me.Lang != L.Lang)
            {
                LanguageChanged?.Invoke(me.Lang!);
                return;
            }
            _ai.IsVisible = _fromText.IsVisible = me.Ai;
            RenderTemplates();
            Select(_list.FirstOrDefault(t => t.File == _selected?.File && t.Key == _selected?.Key) ?? _list.FirstOrDefault());
            _status.Text = _list.Count == 0 ? L.Tr("Nenhum ficheiro tem template de captura.") : "";
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            _status.Text = L.Tr("Não foi possível ligar ao servidor: {0}", e.Message);
        }
        // Anything else would leave the window stuck on "loading" with no list: show it instead.
        catch (Exception e)
        {
            _status.Text = $"{e.GetType().Name}: {e.Message}";
        }
    }

    /// <summary>Opens the internal link panel for the title or notes box last used, keeping its selection as the link's text.</summary>
    private async Task OpenLink()
    {
        var text = _linkTarget.Text ?? "";
        var start = Math.Clamp(Math.Min(_linkTarget.SelectionStart, _linkTarget.SelectionEnd), 0, text.Length);
        var end = Math.Clamp(Math.Max(_linkTarget.SelectionStart, _linkTarget.SelectionEnd), start, text.Length);
        _linkAt = (start, end);
        _linkSearch.Text = "";
        _linkText.Text = text[start..end];
        _linkPanel.IsVisible = true;
        _linkSearch.Focus();
        // The notes' files and headlines, fresh each time.
        try
        {
            _internal = [];
            foreach (var f in await _api.LinkTargets())
            {
                var name = f.File.EndsWith(".org") ? f.File[..^4] : f.File;
                _internal[name] = (f.File, null);
                foreach (var h in f.Headings) _internal.TryAdd($"{name} › {h}", (f.File, h));
            }
            FilterLinks();
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            _status.Text = e.Message;
        }
    }

    /// <summary>Lists the files and headlines that contain every word of the search, and selects the first.</summary>
    private void FilterLinks()
    {
        var words = (_linkSearch.Text ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var matches = _internal.Keys.Where(k => words.All(w => k.Contains(w, StringComparison.CurrentCultureIgnoreCase))).Take(200).ToList();
        _linkList.ItemsSource = matches;
        _linkList.SelectedIndex = matches.Count > 0 ? 0 : -1;
    }

    private void InsertLink()
    {
        var text = _linkText.Text?.Trim();
        if (_linkList.SelectedItem is not string choice || !_internal.TryGetValue(choice, out var to)) return;
        var from = _selected?.File ?? "";
        var heading = to.Heading is { } h ? "*" + h : null;
        // A heading in the same file needs no file name, as in Emacs and the web.
        var target = to.File == from && heading != null ? heading : $"file:{RelativePath(from, to.File)}{(heading != null ? "::" + heading : "")}";
        if (string.IsNullOrEmpty(text)) text = to.Heading ?? Path.GetFileNameWithoutExtension(to.File);
        _linkPanel.IsVisible = false;
        Insert(_linkTarget, OrgLink(target, text), _linkAt.Start, _linkAt.End);
    }

    /// <summary>
    /// Pastes into the title or the notes: a web address alone becomes an org link, described by the selected text if any
    /// (as on the web); anything else, or an address pasted inside a link, is pasted as it is.
    /// </summary>
    private async Task Paste(TextBox box, RoutedEventArgs e)
    {
        e.Handled = true;
        if (Clipboard is not { } clipboard) return;
        // Images pasted on the notes: copied files, or a picture such as a screenshot.
        if (box == _body && await clipboard.TryGetFilesAsync() is { Length: > 0 } files)
        {
            await InsertImages(files);
            return;
        }
        if (box == _body && await clipboard.TryGetBitmapAsync() is { } bitmap)
        {
            using var png = new MemoryStream();
            bitmap.Save(png, new PngBitmapEncoderOptions());
            await InsertImage(png.ToArray());
            return;
        }
        if (await clipboard.TryGetTextAsync() is not { } pasted) return;
        var text = box.Text ?? "";
        var start = Math.Clamp(Math.Min(box.SelectionStart, box.SelectionEnd), 0, text.Length);
        var end = Math.Clamp(Math.Max(box.SelectionStart, box.SelectionEnd), start, text.Length);
        var url = pasted.Trim();
        var isLink = System.Text.RegularExpressions.Regex.IsMatch(url, @"^https?://\S+$", System.Text.RegularExpressions.RegexOptions.IgnoreCase)
            && !System.Text.RegularExpressions.Regex.IsMatch(text[..start], @"\[\[[^\]]*$");
        var value = isLink ? OrgLink(url, text[start..end]) : box.AcceptsReturn ? pasted : pasted.ReplaceLineEndings(" ");
        Insert(box, value, start, end);
    }

    /// <summary>An org link; brackets in the description would end it early, so they become parentheses (as the web).</summary>
    private static string OrgLink(string target, string? description)
    {
        var desc = description?.Trim().Replace('[', '(').Replace(']', ')');
        return !string.IsNullOrEmpty(desc) && desc != target ? $"[[{target}][{desc}]]" : $"[[{target}]]";
    }

    /// <summary>The path of file <paramref name="to"/> as seen from file <paramref name="from"/>'s folder (as the web).</summary>
    private static string RelativePath(string from, string to)
    {
        var fromDirs = from.Split('/')[..^1];
        var toParts = to.Split('/');
        var common = 0;
        while (common < fromDirs.Length && common < toParts.Length - 1 && fromDirs[common] == toParts[common]) common++;
        return string.Join('/', Enumerable.Repeat("..", fromDirs.Length - common).Concat(toParts[common..]));
    }

    // The note's images, each with its width and Recortar, as the web editor's drag-to-resize and crop dialog.
    private readonly StackPanel _images = new() { Spacing = 6 };
    private readonly Dictionary<string, byte[]> _imageData = [];
    private string _imagesShown = "";

    private async Task RefreshImages()
    {
        var text = _body.Text ?? "";
        var links = _selected is null ? [] : OrgImages.LinkRe().Matches(text).DistinctBy(m => m.Value).ToList();
        var shown = string.Join("|", links.Select(m => $"{m.Value}={OrgImages.Width(text, m.Index)}"));
        if (shown == _imagesShown) return;
        _imagesShown = shown;
        _images.Children.Clear();
        foreach (var m in links)
        {
            var path = OrgImages.Resolve(_selected!.File, m.Groups[1].Value);
            try { _imageData[path] = _imageData.GetValueOrDefault(path) ?? await _api.Image(path); }
            catch (HttpRequestException) { continue; }
            if (_imagesShown != shown) return;
            _images.Children.Add(ImageRow(m.Value, _imageData[path], OrgImages.Width(text, m.Index)));
        }
    }

    private Control ImageRow(string link, byte[] data, int? width)
    {
        var size = new TextBox { Text = width?.ToString() ?? "", PlaceholderText = L.Tr("Largura (px)"), Width = 120 };
        void Resize()
        {
            var text = _body.Text ?? "";
            var at = text.IndexOf(link, StringComparison.Ordinal);
            if (at < 0) return;
            int? w = int.TryParse(size.Text, out var px) && px > 0 ? px : null;
            if (w != OrgImages.Width(text, at)) _body.Text = OrgImages.SetWidth(text, at, w);
        }
        size.LostFocus += (_, _) => Resize();
        // Before the text box, which takes Enter for itself.
        size.AddHandler(KeyDownEvent, (_, e) =>
        {
            if (e.Key != Key.Enter) return;
            e.Handled = true;
            Resize();
        }, Avalonia.Interactivity.RoutingStrategies.Tunnel);
        var crop = new Button { Content = L.Tr("Recortar") };
        crop.Click += async (_, _) =>
        {
            if (_selected is not { } t || await new CropWindow(data) { Icon = Icon }.ShowDialog<byte[]?>(this) is not { } cropped) return;
            try
            {
                var path = await _api.UploadImage(t.File, cropped);
                var dir = Path.GetDirectoryName(t.File)?.Replace('\\', '/') ?? "";
                var text = _body.Text ?? "";
                var at = text.IndexOf(link, StringComparison.Ordinal);
                // The cropped copy replaces the link; the width line before it stays.
                if (at >= 0) _body.Text = text[..at] + $"[[file:{(dir == "" ? path : Path.GetRelativePath(dir, path).Replace('\\', '/'))}]]" + text[(at + link.Length)..];
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
            {
                _status.Text = e.Message;
            }
        };
        Bitmap? thumb = null;
        try { thumb = new Bitmap(new MemoryStream(data)); }
        catch (Exception) { /* not an image the app can show: the width and crop still apply */ }
        return new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Children =
            {
                new Image { Source = thumb, Height = 48, MaxWidth = 120, Stretch = Stretch.Uniform },
                size,
                crop,
            },
        };
    }

    private static void Insert(TextBox box, string value, int start, int end)
    {
        var text = box.Text ?? "";
        start = Math.Clamp(start, 0, text.Length);
        end = Math.Clamp(end, start, text.Length);
        box.Text = text[..start] + value + text[end..];
        box.Focus();
        box.CaretIndex = start + value.Length;
    }

    private static readonly string[] ImageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

    /// <summary>Uploads image files (pasted or dropped on the notes) and links them where the cursor is, as the web does.</summary>
    private async Task InsertImages(IEnumerable<IStorageItem> items)
    {
        foreach (var file in items.OfType<IStorageFile>().Where(f => ImageExtensions.Contains(Path.GetExtension(f.Name).ToLowerInvariant())))
        {
            await using var stream = await file.OpenReadAsync();
            using var buffer = new MemoryStream();
            await stream.CopyToAsync(buffer);
            await InsertImage(buffer.ToArray());
        }
    }

    /// <summary>Uploads an image next to the chosen file's notes and links it in the notes at the cursor.</summary>
    private async Task InsertImage(byte[] image)
    {
        if (_selected is not { } t) return;
        var at = _body.CaretIndex;
        _status.Text = L.Tr("A carregar imagem…");
        try
        {
            var path = await _api.UploadImage(t.File, image);
            // Relative to the notes' file, as org (and the web) write file links.
            var dir = Path.GetDirectoryName(t.File)?.Replace('\\', '/') ?? "";
            var link = dir == "" ? path : Path.GetRelativePath(dir, path).Replace('\\', '/');
            Insert(_body, $"[[file:{link}]]", at, at);
            _status.Text = "";
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or IOException)
        {
            _status.Text = e.Message;
        }
    }

    /// <summary>Closes the window for good, e.g. to rebuild it in another language.</summary>
    public void Discard()
    {
        _discarded = true;
        Close();
    }

    private void RenderTemplates() => _templates.ItemsSource = _list.Select(t => $"{t.Key}   {t.Name}  →  {t.File}").ToList();

    private void Select(Template? t)
    {
        _selected = t;
        var i = t is null ? -1 : _list.IndexOf(t);
        if (_templates.SelectedIndex != i) _templates.SelectedIndex = i;
        _when.IsVisible = t?.UsesWhen == true;
        _props.Children.Clear();
        foreach (var p in t?.Props ?? [])
            _props.Children.Add(t!.Options?.GetValueOrDefault(p) is { } options
                ? new AutoCompleteBox { PlaceholderText = p, Tag = p, ItemsSource = options, MinimumPrefixLength = 0, FilterMode = AutoCompleteFilterMode.Contains, HorizontalAlignment = HorizontalAlignment.Stretch }
                : new TextBox { PlaceholderText = p, Tag = p });
    }

    private async void OnKey(object? sender, KeyEventArgs e)
    {
        var typing = FocusManager?.GetFocusedElement() is TextBox;
        Template? hit = null;
        // While the list is open, Enter/Esc/arrows belong to it.
        if (_templates.IsDropDownOpen && e.Key is Key.Enter or Key.Escape or Key.Up or Key.Down) return;
        var inLinkPanel = _linkPanel.IsKeyboardFocusWithin;
        // The arrows in the search move through the matches.
        if (_linkSearch.IsKeyboardFocusWithin && e.Key is Key.Up or Key.Down && _linkList.ItemCount > 0)
        {
            _linkList.SelectedIndex = Math.Clamp(_linkList.SelectedIndex + (e.Key == Key.Down ? 1 : -1), 0, _linkList.ItemCount - 1);
            _linkList.ScrollIntoView(_linkList.SelectedIndex);
        }
        else if (e.Key == Key.Escape && _linkPanel.IsVisible)
        {
            _linkPanel.IsVisible = false;
            _linkTarget.Focus();
        }
        else if (e.Key == Key.Enter && inLinkPanel && e.KeyModifiers == KeyModifiers.None) InsertLink();
        else if (e.Key == Key.L && e.KeyModifiers == KeyModifiers.Control) await OpenLink();
        else if (e.Key == Key.Escape) Hide();
        else if (e.Key == Key.R && e.KeyModifiers == KeyModifiers.Alt) await Review("develop");
        else if (e.Key == Key.R && e.KeyModifiers == (KeyModifiers.Alt | KeyModifiers.Shift)) await Review("fix");
        else if (e.Key == Key.Enter && e.KeyModifiers.HasFlag(KeyModifiers.Control)) await Save();
        else if (!typing && e.Key == Key.Enter) _title.Focus();
        else if (!typing && e.KeySymbol is { Length: 1 } k && (hit = _list.FirstOrDefault(t => t.Key == k)) != null)
        {
            _templates.IsDropDownOpen = false;
            Select(hit);
            _title.Focus();
        }
        else return;
        e.Handled = true;
    }

    private readonly string[] ReviewMessages =
    [
        L.Tr("A afiar o lápis vermelho…"),
        L.Tr("A consultar a professora de Português…"),
        L.Tr("À caça de acentos fugitivos…"),
        L.Tr("A pôr as vírgulas no sítio…"),
        L.Tr("A tirar o pó ao dicionário…"),
        L.Tr("A convencer o corretor ortográfico a trabalhar ao domingo…"),
        L.Tr("A procurar o «ç» que caiu atrás do sofá…"),
        L.Tr("A passar a limpo, com letra bonita…"),
    ];

    private async Task Review(string mode)
    {
        var fields = new Dictionary<string, string> { ["title"] = _title.Text ?? "", ["body"] = _body.Text ?? "" };
        if (!_ai.IsVisible || !_ai.IsEnabled || fields.Values.All(string.IsNullOrWhiteSpace)) return;
        _ai.IsEnabled = false;
        _aiPanel.ShowMessage(ReviewMessages[Random.Shared.Next(ReviewMessages.Length)]);
        try
        {
            _aiPanel.ShowResult(fields, await _api.Improve(fields, mode), new() { ["title"] = L.Tr("Título"), ["body"] = L.Tr("Notas") });
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            _aiPanel.ShowMessage(e.Message);
        }
        finally
        {
            _ai.IsEnabled = true;
        }
    }

    private async Task Save()
    {
        if (_selected is not { } t || string.IsNullOrWhiteSpace(_title.Text)) return;
        TimeOnly? time = null;
        if (_when.IsVisible && !string.IsNullOrWhiteSpace(_time.Text))
        {
            if (!TimeOnly.TryParse(_time.Text, out var parsed))
            {
                _status.Text = L.Tr("Hora inválida (usa HH:MM).");
                return;
            }
            time = parsed;
        }
        DateOnly? date = _when.IsVisible && _date.SelectedDate is { } d ? DateOnly.FromDateTime(d) : null;
        _save.IsEnabled = false;
        try
        {
            var props = _props.Children.ToDictionary(c => (string)c.Tag!, c => (c as TextBox)?.Text ?? (c as AutoCompleteBox)?.Text ?? "");
            await _api.Capture(t, _title.Text.Trim(), _body.Text ?? "", date, date is null ? null : time, props, _tags.Tags);
            Hide();
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            _status.Text = e.Message;
        }
        finally
        {
            _save.IsEnabled = true;
        }
    }
}
