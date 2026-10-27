using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using SkiaSharp;

namespace OrgNotes.Capture;

/// <summary>Crops an image, as the web's image dialog: drag over it to choose the area, then adjust it by its handles or move it; the result is a PNG.</summary>
public class CropWindow : Window
{
    private readonly byte[] _image;
    private readonly Bitmap _bitmap;
    private readonly Image _view;
    private readonly Rectangle _box = new() { Stroke = Brushes.White, StrokeThickness = 2, StrokeDashArray = [4, 3], Fill = new SolidColorBrush(Color.FromArgb(40, 255, 255, 255)), IsVisible = false, IsHitTestVisible = false };
    private readonly Button _crop = new() { Content = L.Tr("Recortar"), Classes = { "accent" }, IsEnabled = false };
    // What the drag does: "new" draws an area, "move" moves it, a compass point (n, se, …) pulls that handle.
    private string? _mode;
    private Point _from;
    private Rect _before;
    private static readonly string[] Handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
    private readonly Dictionary<string, Rectangle> _handles = Handles.ToDictionary(h => h, _ => new Rectangle { Width = 10, Height = 10, Fill = Brushes.White, Stroke = Brushes.DodgerBlue, StrokeThickness = 1.5, IsVisible = false, IsHitTestVisible = false });
    private Rect _selection;

    public CropWindow(byte[] image)
    {
        _image = image;
        _bitmap = new Bitmap(new MemoryStream(image));
        _view = new Image { Source = _bitmap, Stretch = Stretch.Uniform, MaxWidth = 800, MaxHeight = 560 };
        Title = L.Tr("Recortar imagem");
        SizeToContent = SizeToContent.WidthAndHeight;
        CanResize = false;
        Topmost = true;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;

        // A transparent canvas over the image takes the drag and shows the chosen area.
        var canvas = new Canvas { Background = Brushes.Transparent, Cursor = new Cursor(StandardCursorType.Cross), Children = { _box } };
        foreach (var h in _handles.Values) canvas.Children.Add(h);
        canvas.PointerPressed += (_, e) =>
        {
            _from = Clamp(e.GetPosition(_view));
            _before = _selection;
            _mode = _box.IsVisible ? HandleAt(_from) ?? (_selection.Contains(_from) ? "move" : null) : null;
            if (_mode != null) return;
            (_mode, _selection) = ("new", default);
            ShowArea();
        };
        canvas.PointerMoved += (_, e) =>
        {
            var p = Clamp(e.GetPosition(_view));
            if (_mode == null)
            {
                canvas.Cursor = new Cursor(_box.IsVisible ? CursorFor(HandleAt(p) ?? (_selection.Contains(p) ? "move" : "new")) : StandardCursorType.Cross);
                return;
            }
            if (_mode == "new") _selection = Span(_from.X, _from.Y, p.X, p.Y);
            else if (_mode == "move")
                _selection = _before.WithX(Math.Clamp(_before.X + p.X - _from.X, 0, _view.Bounds.Width - _before.Width))
                    .WithY(Math.Clamp(_before.Y + p.Y - _from.Y, 0, _view.Bounds.Height - _before.Height));
            else
            {
                // A handle moves its own edges; the opposite ones stay put.
                var (l, t, r, b) = (_before.Left, _before.Top, _before.Right, _before.Bottom);
                if (_mode.Contains('w')) l = p.X;
                if (_mode.Contains('e')) r = p.X;
                if (_mode.Contains('n')) t = p.Y;
                if (_mode.Contains('s')) b = p.Y;
                _selection = Span(l, t, r, b);
            }
            ShowArea();
        };
        canvas.PointerReleased += (_, _) =>
        {
            _mode = null;
            if (_selection.Width <= 4 || _selection.Height <= 4) _selection = default;
            ShowArea();
        };

        var cancel = new Button { Content = L.Tr("Cancelar") };
        cancel.Click += (_, _) => Close(null);
        _crop.Click += (_, _) => Close(Crop());
        Content = new StackPanel
        {
            Margin = new Thickness(16),
            Spacing = 10,
            Children =
            {
                new TextBlock { Text = L.Tr("Arrasta sobre a imagem para escolher a área a recortar; depois ajusta-a pelos pontos ou arrasta-a."), Opacity = 0.7 },
                new Grid { Children = { _view, canvas } },
                new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Spacing = 8, Children = { cancel, _crop } },
            },
        };
    }

    private static Rect Span(double x1, double y1, double x2, double y2) => new(Math.Min(x1, x2), Math.Min(y1, y2), Math.Abs(x2 - x1), Math.Abs(y2 - y1));

    private Point HandlePoint(string h) => new(
        h.Contains('w') ? _selection.Left : h.Contains('e') ? _selection.Right : _selection.Center.X,
        h.Contains('n') ? _selection.Top : h.Contains('s') ? _selection.Bottom : _selection.Center.Y);

    private string? HandleAt(Point p) => Handles.FirstOrDefault(h => Math.Abs(HandlePoint(h).X - p.X) <= 7 && Math.Abs(HandlePoint(h).Y - p.Y) <= 7);

    private static StandardCursorType CursorFor(string mode) => mode switch
    {
        "nw" => StandardCursorType.TopLeftCorner,
        "ne" => StandardCursorType.TopRightCorner,
        "se" => StandardCursorType.BottomRightCorner,
        "sw" => StandardCursorType.BottomLeftCorner,
        "n" => StandardCursorType.TopSide,
        "s" => StandardCursorType.BottomSide,
        "e" => StandardCursorType.RightSide,
        "w" => StandardCursorType.LeftSide,
        "move" => StandardCursorType.SizeAll,
        _ => StandardCursorType.Cross,
    };

    /// <summary>Draws the chosen area and its handles, and enables Recortar when there is one.</summary>
    private void ShowArea()
    {
        var visible = _selection.Width > 0 && _selection.Height > 0;
        Canvas.SetLeft(_box, _selection.X);
        Canvas.SetTop(_box, _selection.Y);
        (_box.Width, _box.Height, _box.IsVisible) = (_selection.Width, _selection.Height, visible);
        foreach (var (h, r) in _handles)
        {
            var p = HandlePoint(h);
            Canvas.SetLeft(r, p.X - 5);
            Canvas.SetTop(r, p.Y - 5);
            r.IsVisible = visible && _mode == null;
        }
        _crop.IsEnabled = _selection.Width > 4 && _selection.Height > 4;
    }

    private Point Clamp(Point p) => new(Math.Clamp(p.X, 0, _view.Bounds.Width), Math.Clamp(p.Y, 0, _view.Bounds.Height));

    /// <summary>The chosen area of the full-size image (the selection is drawn on the shown, scaled one), as a PNG.</summary>
    private byte[]? Crop()
    {
        using var source = SKBitmap.Decode(_image);
        var scale = source.Width / _view.Bounds.Width;
        var area = new SKRectI((int)(_selection.X * scale), (int)(_selection.Y * scale), (int)(_selection.Right * scale), (int)(_selection.Bottom * scale));
        area.Intersect(new SKRectI(0, 0, source.Width, source.Height));
        if (area.IsEmpty) return null;
        using var cropped = new SKBitmap(area.Width, area.Height);
        using (var canvas = new SKCanvas(cropped)) canvas.DrawBitmap(source, area, new SKRect(0, 0, area.Width, area.Height));
        using var image = SKImage.FromBitmap(cropped);
        using var png = image.Encode(SKEncodedImageFormat.Png, 100);
        return png.ToArray();
    }
}
