using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace OrgNotes.Capture;

/// <summary>System-wide shortcut on Windows via RegisterHotKey, on a thread with its own message loop.</summary>
[SupportedOSPlatform("windows")]
public static partial class WindowsHotkey
{
    private const uint ModAlt = 1, ModControl = 2, ModShift = 4, ModWin = 8, ModNoRepeat = 0x4000, WmHotkey = 0x0312;

    [StructLayout(LayoutKind.Sequential)]
    private struct Msg
    {
        public IntPtr Hwnd;
        public uint Message;
        public UIntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public int X, Y;
    }

    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint vk);

    [LibraryImport("user32.dll", EntryPoint = "GetMessageW")]
    private static partial int GetMessage(out Msg msg, IntPtr hWnd, uint min, uint max);

    /// <summary>Registers e.g. "Win+Alt+C" and calls `pressed` on each press. False if the text is invalid or the key is taken.</summary>
    public static bool Register(string hotkey, Action pressed)
    {
        uint mods = ModNoRepeat, vk = 0;
        foreach (var part in hotkey.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            switch (part.ToLowerInvariant())
            {
                case "ctrl" or "control": mods |= ModControl; break;
                case "alt": mods |= ModAlt; break;
                case "shift": mods |= ModShift; break;
                case "win": mods |= ModWin; break;
                case var k when k.Length == 1 && char.IsLetterOrDigit(k[0]): vk = char.ToUpperInvariant(k[0]); break;
                case var k when k.StartsWith('f') && int.TryParse(k[1..], out var n) && n is >= 1 and <= 24: vk = (uint)(0x6F + n); break;
                case "space": vk = 0x20; break;
                default: return false;
            }
        }
        if (vk == 0) return false;
        var registered = false;
        using var ready = new ManualResetEventSlim();
        var thread = new Thread(() =>
        {
            // Thread-bound hotkey (no window): WM_HOTKEY arrives in this thread's queue.
            registered = RegisterHotKey(IntPtr.Zero, 1, mods, vk);
            ready.Set();
            if (!registered) return;
            while (GetMessage(out var msg, IntPtr.Zero, 0, 0) > 0)
                if (msg.Message == WmHotkey) pressed();
        }) { IsBackground = true, Name = "hotkey" };
        thread.Start();
        ready.Wait();
        return registered;
    }
}
