using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace OrgNotes.Server;

/// <summary>
/// The login page: email and password for the emails in Auth:AllowedEmails (each sets their own password the
/// first time), plus Google / Microsoft buttons for the providers that are configured.
/// </summary>
public static class Login
{
    public static void Map(WebApplication app, string[] allowed, string[] providers)
    {
        bool IsAllowed(string email) => allowed.Any(a => Users.KeyOfEmail(a) == Users.KeyOfEmail(email));

        // ?lang= picks the page's language (kept in a cookie) before the user has a setting of their own.
        app.MapGet("/login", (string? returnUrl, string? lang, HttpContext ctx) =>
        {
            if (Strings.IsLang(lang)) ctx.Response.Cookies.Append("lang", lang!, new CookieOptions { MaxAge = TimeSpan.FromDays(365), SameSite = SameSiteMode.Lax });
            return Page(returnUrl, providers, "", Strings.IsLang(lang) ? lang! : Strings.Of(ctx));
        });

        app.MapPost("/login", async (HttpContext ctx, Users users) =>
        {
            var form = await ctx.Request.ReadFormAsync();
            string email = form["email"].ToString().Trim(), password = form["password"].ToString(), returnUrl = form["returnUrl"].ToString();
            var key = Users.KeyOfEmail(email);
            var lang = Strings.Of(ctx);
            IResult Error(string message, params object[] args) => Page(returnUrl, providers, Strings.Tr(lang, message, args), lang, email);

            if (form["action"] == "register")
            {
                if (!IsAllowed(email)) return Error("{0} não está autorizado.", email);
                if (users.HasPassword(key)) return Error("Esta conta já tem password: entra com ela.");
                if (password.Length < 8) return Error("A password precisa de pelo menos 8 caracteres.");
                users.SetPassword(key, password);
            }
            else if (!IsAllowed(email) || !users.CheckPassword(key, password)) return Error("Email ou password errados.");

            var identity = new ClaimsIdentity([new Claim(ClaimTypes.Email, email)], CookieAuthenticationDefaults.AuthenticationScheme);
            await ctx.SignInAsync(new ClaimsPrincipal(identity), new AuthenticationProperties { IsPersistent = true });
            return Results.LocalRedirect(Local(returnUrl));
        }).RequireRateLimiting("login");

        app.MapGet("/login/{provider}", (string provider, string? returnUrl) =>
            providers.Contains(provider)
                ? Results.Challenge(new AuthenticationProperties { RedirectUri = Local(returnUrl) }, [provider])
                : Results.NotFound());

        app.MapGet("/logout", async (HttpContext ctx) =>
        {
            await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.Redirect("/login");
        });
    }

    /// <summary>Only same-site paths, so the login cannot be used to redirect elsewhere.</summary>
    private static string Local(string? url) => url is ['/', not '/' and not '\\', ..] or "/" ? url : "/";

    private static IResult Page(string? returnUrl, string[] providers, string error, string lang, string email = "")
    {
        static string E(string s) => WebUtility.HtmlEncode(s);
        string T(string pt, params object[] args) => E(Strings.Tr(lang, pt, args));
        var langs = string.Join(" · ", Strings.Langs.Select(l => l == lang ? $"<b>{l.ToUpperInvariant()}</b>" : $"""<a href="/login?lang={l}&returnUrl={Uri.EscapeDataString(Local(returnUrl))}">{l.ToUpperInvariant()}</a>"""));
        var buttons = string.Concat(providers.Select(p =>
            $"""<a class="btn" href="/login/{p}?returnUrl={Uri.EscapeDataString(Local(returnUrl))}">{T("Entrar com {0}", p == "Microsoft" ? "Microsoft (Office)" : p)}</a>"""));
        var html = $$"""
            <!doctype html>
            <html lang="{{lang}}">
            <head>
            <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
            <link rel="icon" href="/favicon.svg" type="image/svg+xml">
            <link rel="apple-touch-icon" href="/apple-touch-icon.png">
            <title>{{T("Entrar")}} · Org Notes</title>
            <style>
              :root { color-scheme: light dark; --bg: #f6f6f4; --card: #fff; --fg: #222; --muted: #666; --line: #ddd; --accent: #3b6ea8; }
              @media (prefers-color-scheme: dark) { :root { --bg: #1b1b1d; --card: #252528; --fg: #e6e6e6; --muted: #999; --line: #3a3a3e; --accent: #7aa7e0; } }
              body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 15px system-ui, sans-serif; }
              main { width: min(340px, calc(100vw - 32px)); background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 24px; }
              h1 { font-size: 20px; margin: 0 0 16px; }
              label { display: block; margin: 10px 0 4px; color: var(--muted); font-size: 13px; }
              input { box-sizing: border-box; width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit; }
              button, .btn { display: block; box-sizing: border-box; width: 100%; margin-top: 12px; padding: 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit; text-align: center; text-decoration: none; cursor: pointer; }
              button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
              .error { color: #c0392b; margin: 0 0 8px; }
              .hint { color: var(--muted); font-size: 13px; }
              hr { border: 0; border-top: 1px solid var(--line); margin: 18px 0 6px; }
              .langs { margin: 14px 0 0; text-align: center; color: var(--muted); font-size: 13px; }
              .langs a { color: var(--muted); }
            </style>
            </head>
            <body>
            <main>
              <h1>Org Notes</h1>
              {{(error == "" ? "" : $"<p class=\"error\">{E(error)}</p>")}}
              <form method="post" action="/login">
                <input type="hidden" name="returnUrl" value="{{E(Local(returnUrl))}}">
                <label for="email">Email</label>
                <input id="email" name="email" type="email" autocomplete="username" required autofocus value="{{E(email)}}">
                <label for="password">{{T("Password")}}</label>
                <input id="password" name="password" type="password" autocomplete="current-password" required>
                <button class="primary" name="action" value="login">{{T("Entrar")}}</button>
                <button name="action" value="register">{{T("Criar password (primeira vez)")}}</button>
              </form>
              {{(buttons == "" ? "" : "<hr>" + buttons)}}
              <p class="langs">{{langs}}</p>
            </main>
            </body>
            </html>
            """;
        return Results.Content(html, "text/html; charset=utf-8");
    }
}
