using System.Security.Claims;
using Microsoft.Net.Http.Headers;

namespace OrgNotes.Server;

/// <summary>
/// The server's user-facing texts in the interface languages, keyed by the Portuguese text (also the fallback).
/// Placeholders are string.Format's {0}, {1}...
/// </summary>
public static class Strings
{
    public static readonly string[] Langs = ["pt", "en", "fr", "es"];

    private static readonly Dictionary<string, (string En, string Fr, string Es)> T = new()
    {
        // Login
        ["Entrar"] = ("Sign in", "Se connecter", "Entrar"),
        ["Entrar com {0}"] = ("Sign in with {0}", "Se connecter avec {0}", "Entrar con {0}"),
        ["Criar password (primeira vez)"] = ("Create password (first time)", "Créer un mot de passe (première fois)", "Crear contraseña (primera vez)"),
        ["Password"] = ("Password", "Mot de passe", "Contraseña"),
        ["{0} não está autorizado."] = ("{0} is not allowed.", "{0} n'est pas autorisé.", "{0} no está autorizado."),
        ["Esta conta já tem password: entra com ela."] = ("This account already has a password: sign in with it.", "Ce compte a déjà un mot de passe : connecte-toi avec.", "Esta cuenta ya tiene contraseña: entra con ella."),
        ["A password precisa de pelo menos 8 caracteres."] = ("The password needs at least 8 characters.", "Le mot de passe doit contenir au moins 8 caractères.", "La contraseña necesita al menos 8 caracteres."),
        ["Email ou password errados."] = ("Wrong email or password.", "E-mail ou mot de passe incorrect.", "Email o contraseña incorrectos."),
        ["Sem acesso: {0} não está autorizado. Sair: /logout"] = ("No access: {0} is not allowed. Sign out: /logout", "Pas d'accès : {0} n'est pas autorisé. Se déconnecter : /logout", "Sin acceso: {0} no está autorizado. Salir: /logout"),
        // API errors
        ["Nome de pasta inválido"] = ("Invalid folder name", "Nom de dossier non valide", "Nombre de carpeta no válido"),
        ["Só se pode apagar uma pasta vazia"] = ("Only an empty folder can be deleted", "Seul un dossier vide peut être supprimé", "Solo se puede eliminar una carpeta vacía"),
        ["O ícone tem de ser um PNG até 256 KB"] = ("The icon must be a PNG up to 256 KB", "L'icône doit être un PNG de 256 Ko maximum", "El icono debe ser un PNG de hasta 256 KB"),
        ["Ficheiro inválido"] = ("Invalid file", "Fichier non valide", "Archivo no válido"),
        ["A imagem tem de ser PNG, JPEG, GIF ou WebP, até 10 MB"] = ("The image must be PNG, JPEG, GIF or WebP, up to 10 MB", "L'image doit être en PNG, JPEG, GIF ou WebP, jusqu'à 10 Mo", "La imagen debe ser PNG, JPEG, GIF o WebP, de hasta 10 MB"),
        ["Template não encontrado"] = ("Template not found", "Modèle introuvable", "Plantilla no encontrada"),
        ["Falta o título"] = ("The title is missing", "Le titre manque", "Falta el título"),
        ["Falta a descrição"] = ("The description is missing", "La description manque", "Falta la descripción"),
        ["IA não configurada"] = ("AI is not configured", "IA non configurée", "IA no configurada"),
        ["Demasiados pedidos à IA; tenta daqui a pouco."] = ("Too many AI requests; try again shortly.", "Trop de requêtes à l'IA ; réessaie dans un instant.", "Demasiadas peticiones a la IA; inténtalo dentro de un rato."),
        ["A IA falhou: {0}"] = ("The AI failed: {0}", "L'IA a échoué : {0}", "La IA falló: {0}"),
        ["O pedido foi recusado pelo modelo."] = ("The model refused the request.", "Le modèle a refusé la requête.", "El modelo rechazó la petición."),
        ["Resposta vazia do modelo."] = ("Empty answer from the model.", "Réponse vide du modèle.", "Respuesta vacía del modelo."),
        ["Falta configurar Ai:Model."] = ("Ai:Model is not configured.", "Ai:Model n'est pas configuré.", "Falta configurar Ai:Model."),
        ["Email inválido ou já autorizado"] = ("Invalid email, or already allowed", "E-mail non valide ou déjà autorisé", "Email no válido o ya autorizado"),
        ["Só se podem retirar os emails acrescentados aqui"] = ("Only the emails added here can be removed", "Seuls les e-mails ajoutés ici peuvent être retirés", "Solo se pueden quitar los emails añadidos aquí"),
        // Notifications
        ["em {0} min"] = ("in {0} min", "dans {0} min", "en {0} min"),
        ["agora"] = ("now", "maintenant", "ahora"),
        ["Prazo"] = ("Deadline", "Échéance", "Plazo"),
        ["Agenda"] = ("Agenda", "Agenda", "Agenda"),
        ["Agenda de hoje"] = ("Today's agenda", "Agenda du jour", "Agenda de hoy"),
        ["Prazo hoje"] = ("Due today", "Échéance aujourd'hui", "Vence hoy"),
        ["Prazo amanhã"] = ("Due tomorrow", "Échéance demain", "Vence mañana"),
        ["Prazo em {0} dias"] = ("Due in {0} days", "Échéance dans {0} jours", "Vence en {0} días"),
        ["{0} às {1}"] = ("{0} at {1}", "{0} à {1}", "{0} a las {1}"),
        ["⚠ Prazo há {0} d: {1}"] = ("⚠ Overdue {0} d: {1}", "⚠ En retard de {0} j : {1}", "⚠ Vencido hace {0} d: {1}"),
        ["Agendado há {0} d: {1}"] = ("Scheduled {0} d ago: {1}", "Planifié il y a {0} j : {1}", "Programado hace {0} d: {1}"),
        ["Prazo em {0} d: {1}"] = ("Due in {0} d: {1}", "Échéance dans {0} j : {1}", "Vence en {0} d: {1}"),
        ["{0} Prazo: {1}"] = ("{0} Deadline: {1}", "{0} Échéance : {1}", "{0} Plazo: {1}"),
        ["… e mais {0}"] = ("… and {0} more", "… et {0} de plus", "… y {0} más"),
    };

    public static bool IsLang(string? lang) => lang != null && Langs.Contains(lang);

    public static string Tr(string lang, string pt, params object[] args)
    {
        var text = lang == "pt" || !T.TryGetValue(pt, out var t) ? pt : lang switch { "en" => t.En, "fr" => t.Fr, "es" => t.Es, _ => pt };
        return args.Length == 0 ? text : string.Format(text, args);
    }

    /// <summary>The request's language: the user's setting, else the `lang` cookie, else the browser's, else Portuguese.</summary>
    public static string Of(HttpContext ctx)
    {
        var users = ctx.RequestServices.GetRequiredService<Users>();
        if (ctx.User.FindFirstValue(ClaimTypes.Email) is { } email && users.Exists(Users.KeyOfEmail(email))
            && users.Settings(Users.KeyOfEmail(email)).Lang is { } own && IsLang(own)) return own;
        if (ctx.Request.Cookies["lang"] is { } cookie && IsLang(cookie)) return cookie;
        var browser = ctx.Request.GetTypedHeaders().AcceptLanguage
            .OrderByDescending(l => l.Quality ?? 1)
            .Select(l => l.Value.Value?.Split('-')[0].ToLowerInvariant())
            .FirstOrDefault(IsLang);
        return browser ?? "pt";
    }

    /// <summary>Translates for the request's language.</summary>
    public static string Tr(HttpContext ctx, string pt, params object[] args) => Tr(Of(ctx), pt, args);
}
