using System.Globalization;

namespace OrgNotes.Capture;

/// <summary>
/// The app's texts in the interface languages, keyed by the Portuguese text (also the fallback). The language is
/// the user's setting on the server, remembered in the config; placeholders are string.Format's {0}, {1}...
/// </summary>
public static class L
{
    public static readonly string[] Langs = ["pt", "en", "fr", "es"];

    /// <summary>The current language: the remembered one, else the system's, else Portuguese.</summary>
    public static string Lang { get; set; } = "pt";

    public static string Initial(string remembered) =>
        Langs.Contains(remembered) ? remembered : Langs.FirstOrDefault(l => l == CultureInfo.CurrentUICulture.TwoLetterISOLanguageName) ?? "pt";

    private static readonly Dictionary<string, (string En, string Fr, string Es)> T = new()
    {
        // Tray
        ["Capturar"] = ("Capture", "Capturer", "Capturar"),
        ["Definições"] = ("Settings", "Paramètres", "Ajustes"),
        ["Sair"] = ("Quit", "Quitter", "Salir"),
        ["Org Notes · Capturar"] = ("Org Notes · Capture", "Org Notes · Capturer", "Org Notes · Capturar"),
        ["Org Notes · Capturar ({0})"] = ("Org Notes · Capture ({0})", "Org Notes · Capturer ({0})", "Org Notes · Capturar ({0})"),
        ["Org Notes · atalho {0} indisponível (muda nas Definições)"] = ("Org Notes · shortcut {0} unavailable (change it in Settings)", "Org Notes · raccourci {0} indisponible (change-le dans les Paramètres)", "Org Notes · atajo {0} no disponible (cámbialo en Ajustes)"),
        // Capture window
        ["Capturar · Org Notes"] = ("Capture · Org Notes", "Capturer · Org Notes", "Capturar · Org Notes"),
        ["Ficheiro"] = ("File", "Fichier", "Archivo"),
        ["Título"] = ("Title", "Titre", "Título"),
        ["Data"] = ("Date", "Date", "Fecha"),
        ["Hora (HH:MM)"] = ("Time (HH:MM)", "Heure (HH:MM)", "Hora (HH:MM)"),
        ["Notas (opcional, sintaxe org)"] = ("Notes (optional, org syntax)", "Notes (facultatif, syntaxe org)", "Notas (opcional, sintaxis org)"),
        ["Notas"] = ("Notes", "Notes", "Notas"),
        ["Guardar (Ctrl+Enter)"] = ("Save (Ctrl+Enter)", "Enregistrer (Ctrl+Enter)", "Guardar (Ctrl+Enter)"),
        ["Cancelar"] = ("Cancel", "Annuler", "Cancelar"),
        ["Desenvolver"] = ("Develop", "Développer", "Desarrollar"),
        ["Corrigir"] = ("Fix", "Corriger", "Corregir"),
        ["Resumir"] = ("Summarize", "Résumer", "Resumir"),
        ["Tom profissional"] = ("Professional tone", "Ton professionnel", "Tono profesional"),
        ["Extrair tarefas"] = ("Extract tasks", "Extraire les tâches", "Extraer tareas"),
        ["IA: desenvolver, corrigir, resumir… (Alt+R)"] = ("AI: develop, fix, summarize… (Alt+R)", "IA : développer, corriger, résumer… (Alt+R)", "IA: desarrollar, corregir, resumir… (Alt+R)"),
        ["Escolhe o ficheiro na lista (↑ ↓) ou pela tecla do template; Enter passa ao título."] = ("Pick the file in the list (↑ ↓) or by the template's key; Enter moves to the title.", "Choisis le fichier dans la liste (↑ ↓) ou par la touche du modèle ; Entrée passe au titre.", "Elige el archivo en la lista (↑ ↓) o por la tecla de la plantilla; Enter pasa al título."),
        ["A carregar templates…"] = ("Loading templates…", "Chargement des modèles…", "Cargando plantillas…"),
        ["Nenhum ficheiro tem template de captura."] = ("No file has a capture template.", "Aucun fichier n'a de modèle de capture.", "Ningún archivo tiene plantilla de captura."),
        ["Não foi possível ligar ao servidor: {0}"] = ("Could not connect to the server: {0}", "Impossible de joindre le serveur : {0}", "No se pudo conectar con el servidor: {0}"),
        ["Hora inválida (usa HH:MM)."] = ("Invalid time (use HH:MM).", "Heure non valide (utilise HH:MM).", "Hora no válida (usa HH:MM)."),
        ["A afiar o lápis vermelho…"] = ("Sharpening the red pencil…", "Je taille le crayon rouge…", "Afilando el lápiz rojo…"),
        ["A consultar a professora de Português…"] = ("Asking the English teacher…", "Je consulte la prof de français…", "Consultando a la profesora de lengua…"),
        ["À caça de acentos fugitivos…"] = ("Hunting down runaway commas…", "À la chasse aux accents fugitifs…", "A la caza de tildes fugitivas…"),
        ["A pôr as vírgulas no sítio…"] = ("Putting the commas in their place…", "Je remets les virgules à leur place…", "Poniendo las comas en su sitio…"),
        ["A tirar o pó ao dicionário…"] = ("Dusting off the dictionary…", "Je dépoussière le dictionnaire…", "Quitándole el polvo al diccionario…"),
        ["A convencer o corretor ortográfico a trabalhar ao domingo…"] = ("Talking the spellchecker into working on Sunday…", "Je convaincs le correcteur de travailler le dimanche…", "Convenciendo al corrector de trabajar el domingo…"),
        ["A procurar o «ç» que caiu atrás do sofá…"] = ("Looking for the apostrophe that fell behind the sofa…", "Je cherche le « ç » tombé derrière le canapé…", "Buscando la «ñ» que se cayó detrás del sofá…"),
        ["A passar a limpo, com letra bonita…"] = ("Making a fair copy, in neat handwriting…", "Je recopie au propre, avec une belle écriture…", "Pasando a limpio, con buena letra…"),
        ["Texto (opcional)"] = ("Text (optional)", "Texte (facultatif)", "Texto (opcional)"),
        ["Inserir"] = ("Insert", "Insérer", "Insertar"),
        ["Imagem"] = ("Image", "Image", "Imagen"),
        ["Imagens"] = ("Images", "Images", "Imágenes"),
        ["ou cola / arrasta uma imagem para as notas"] = ("or paste / drop an image on the notes", "ou colle / glisse une image dans les notes", "o pega / arrastra una imagen a las notas"),
        ["A carregar imagem…"] = ("Uploading image…", "Envoi de l'image…", "Subiendo imagen…"),
        ["Versão {0}"] = ("Version {0}", "Version {0}", "Versión {0}"),
        ["Atualizada para v{0}"] = ("Updated to v{0}", "Mise à jour vers v{0}", "Actualizada a v{0}"),
        ["Versão de desenvolvimento"] = ("Development version", "Version de développement", "Versión de desarrollo"),
        ["Procurar atualizações"] = ("Check for updates", "Rechercher des mises à jour", "Buscar actualizaciones"),
        ["Falta configurar o servidor e o token."] = ("The server and token are not set up yet.", "Le serveur et le jeton ne sont pas encore configurés.", "Falta configurar el servidor y el token."),
        ["O servidor não tem instalador."] = ("The server has no installer.", "Le serveur n'a pas d'installateur.", "El servidor no tiene instalador."),
        ["Já tens a versão mais recente ({0})."] = ("You already have the latest version ({0}).", "Tu as déjà la dernière version ({0}).", "Ya tienes la versión más reciente ({0})."),
        ["Link interno"] = ("Internal link", "Lien interne", "Enlace interno"),
        ["Link para um ficheiro ou título das notas"] = ("Link to a file or headline in your notes", "Lien vers un fichier ou un titre des notes", "Enlace a un archivo o título de las notas"),
        ["Procurar ficheiro ou título"] = ("Search file or headline", "Chercher un fichier ou un titre", "Buscar archivo o título"),
        ["Do texto (IA)"] = ("From text (AI)", "Depuis un texte (IA)", "Desde texto (IA)"),
        ["Criar a partir de texto (IA)"] = ("Create from text (AI)", "Créer à partir d'un texte (IA)", "Crear a partir de texto (IA)"),
        ["Criar tarefas, eventos e contactos a partir de um email ou outro texto"] = ("Create tasks, events and contacts from an email or other text", "Créer des tâches, des événements et des contacts à partir d'un e-mail ou d'un autre texte", "Crear tareas, eventos y contactos a partir de un email u otro texto"),
        ["Cola aqui o texto…"] = ("Paste the text here…", "Colle le texte ici…", "Pega aquí el texto…"),
        ["Cola um email ou outro texto: a IA propõe tarefas, eventos e contactos com os teus templates, e tu revês antes de criar."] = ("Paste an email or other text: the AI proposes tasks, events and contacts with your templates, and you review them before creating.", "Colle un e-mail ou un autre texte : l'IA propose des tâches, des événements et des contacts avec tes modèles, et tu les vérifies avant de les créer.", "Pega un email u otro texto: la IA propone tareas, eventos y contactos con tus plantillas, y tú los revisas antes de crearlos."),
        ["Analisar"] = ("Analyse", "Analyser", "Analizar"),
        ["A analisar…"] = ("Analysing…", "Analyse…", "Analizando…"),
        ["Voltar"] = ("Back", "Retour", "Volver"),
        ["A IA não encontrou nada para criar neste texto."] = ("The AI found nothing to create in this text.", "L'IA n'a rien trouvé à créer dans ce texte.", "La IA no encontró nada que crear en este texto."),
        ["Criar {0} itens"] = ("Create {0} items", "Créer {0} éléments", "Crear {0} elementos"),
        ["Lembretes · Org Notes"] = ("Reminders · Org Notes", "Rappels · Org Notes", "Recordatorios · Org Notes"),
        ["Adiar 5 min"] = ("Snooze 5 min", "Reporter de 5 min", "Posponer 5 min"),
        ["Ver"] = ("View", "Voir", "Ver"),
        ["Adiar 15 min"] = ("Snooze 15 min", "Reporter de 15 min", "Posponer 15 min"),
        ["Adiar 1 h"] = ("Snooze 1 h", "Reporter d'1 h", "Posponer 1 h"),
        ["Testar lembrete"] = ("Test reminder", "Tester un rappel", "Probar recordatorio"),
        ["Teste de lembrete"] = ("Test reminder", "Rappel de test", "Recordatorio de prueba"),
        ["Assim vais ver os lembretes da agenda."] = ("This is how the agenda reminders will show.", "Voici comment s'afficheront les rappels de l'agenda.", "Así verás los recordatorios de la agenda."),
        ["Mostrar os lembretes numa janela por cima das outras"] = ("Show reminders in a window above the others", "Afficher les rappels dans une fenêtre au-dessus des autres", "Mostrar los recordatorios en una ventana encima de las demás"),
        ["Captura igual à do site (desliga para usar a janela antiga da app)"] = ("Capture as on the site (turn off to use the app's older window)", "Capture comme sur le site (désactive pour la fenêtre ancienne de l'app)", "Captura igual que en el sitio (desactiva para usar la ventana antigua de la app)"),
        ["A captura do site não abriu neste computador: abre a janela da app. Detalhes em {0}"] = ("The site's capture did not open on this computer: the app's window opens instead. Details in {0}", "La capture du site ne s'est pas ouverte sur cet ordinateur : la fenêtre de l'app s'ouvre à la place. Détails dans {0}", "La captura del sitio no se abrió en este ordenador: se abre la ventana de la app. Detalles en {0}"),
        ["Abrir registo de erros"] = ("Open error log", "Ouvrir le journal des erreurs", "Abrir registro de errores"),
        ["Etiquetas"] = ("Tags", "Étiquettes", "Etiquetas"),
        ["Novas etiquetas (separadas por espaços)"] = ("New tags (separated by spaces)", "Nouvelles étiquettes (séparées par des espaces)", "Etiquetas nuevas (separadas por espacios)"),
        ["Recortar"] = ("Crop", "Recadrer", "Recortar"),
        ["Recortar imagem"] = ("Crop image", "Recadrer l'image", "Recortar imagen"),
        ["Arrasta sobre a imagem para escolher a área a recortar; depois ajusta-a pelos pontos ou arrasta-a."] = ("Drag over the image to choose the area to keep; then adjust it by its handles or drag it.", "Glisse sur l'image pour choisir la zone à garder ; puis ajuste-la par ses poignées ou déplace-la.", "Arrastra sobre la imagen para elegir la zona a recortar; luego ajústala con los puntos o arrástrala."),
        // AI review panel
        ["Sem sugestões: o texto parece estar bem."] = ("No suggestions: the text looks fine.", "Aucune suggestion : le texte semble correct.", "Sin sugerencias: el texto parece estar bien."),
        ["Descartar"] = ("Discard", "Ignorer", "Descartar"),
        ["Aceitar"] = ("Accept", "Accepter", "Aceptar"),
        // Settings
        ["Definições · Org Notes Capture"] = ("Settings · Org Notes Capture", "Paramètres · Org Notes Capture", "Ajustes · Org Notes Capture"),
        ["Só necessário com login Google"] = ("Only needed with Google sign-in", "Nécessaire seulement avec la connexion Google", "Solo necesario con el inicio de sesión de Google"),
        ["Mostrar lembretes da agenda neste computador"] = ("Show agenda reminders on this computer", "Afficher les rappels de l'agenda sur cet ordinateur", "Mostrar recordatorios de la agenda en este equipo"),
        ["Arrancar com o Windows"] = ("Start with Windows", "Démarrer avec Windows", "Iniciar con Windows"),
        ["Testar ligação"] = ("Test connection", "Tester la connexion", "Probar conexión"),
        ["Guardar"] = ("Save", "Enregistrer", "Guardar"),
        ["A testar…"] = ("Testing…", "Test en cours…", "Probando…"),
        ["Ligação OK · {0} templates."] = ("Connection OK · {0} templates.", "Connexion OK · {0} modèles.", "Conexión OK · {0} plantillas."),
        ["Servidor"] = ("Server", "Serveur", "Servidor"),
        ["Token (no site: sino → Conta e notificações)"] = ("Token (on the site: bell → Account and notifications)", "Jeton (sur le site : cloche → Compte et notifications)", "Token (en el sitio: campana → Cuenta y notificaciones)"),
        ["Atalho global, ex. Win+Alt+C (reinicia a app para aplicar)"] = ("Global shortcut, e.g. Win+Alt+C (restart the app to apply)", "Raccourci global, ex. Win+Alt+C (redémarre l'application pour appliquer)", "Atajo global, ej. Win+Alt+C (reinicia la app para aplicarlo)"),
        ["No Linux o atalho é definido no ambiente de trabalho: liga uma tecla a «OrgNotes.Capture --show»."] = ("On Linux the shortcut is set in the desktop environment: bind a key to “OrgNotes.Capture --show”.", "Sous Linux, le raccourci se définit dans l'environnement de bureau : associe une touche à « OrgNotes.Capture --show ».", "En Linux el atajo se define en el entorno de escritorio: asigna una tecla a «OrgNotes.Capture --show»."),
        // Server errors
        ["Erro {0}: {1}"] = ("Error {0}: {1}", "Erreur {0} : {1}", "Error {0}: {1}"),
        ["Resposta vazia."] = ("Empty answer.", "Réponse vide.", "Respuesta vacía."),
        ["Token em falta ou inválido (vê Conta e notificações no site)."] = ("Missing or invalid token (see Account and notifications on the site).", "Jeton manquant ou non valide (voir Compte et notifications sur le site).", "Token ausente o no válido (mira Cuenta y notificaciones en el sitio)."),
        ["Este utilizador não tem acesso ao servidor."] = ("This user has no access to the server.", "Cet utilisateur n'a pas accès au serveur.", "Este usuario no tiene acceso al servidor."),
    };

    public static string Tr(string pt, params object[] args)
    {
        var text = Lang == "pt" || !T.TryGetValue(pt, out var t) ? pt : Lang switch { "en" => t.En, "fr" => t.Fr, "es" => t.Es, _ => pt };
        return args.Length == 0 ? text : string.Format(text, args);
    }
}
