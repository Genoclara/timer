# Lunaria Timer ☾

Un timer pour OBS aux couleurs de Lunaria. Il a deux usages :

1. **Starting Soon (hors ligne)** : un compte à rebours avant le début du stream. Il marche sans Internet et sans serveur, directement depuis votre PC.
2. **Lunariathon, Subathon et Donathon** : le timer augmente tout seul à chaque sub (T1, T2, T3, Prime), sub offert, don et bits reçu via StreamElements. Tout se règle depuis un panneau web. Le serveur tourne sur votre bot Discord (Sparked Host).

| Fichier | Rôle |
| --- | --- |
| `public/overlay.html` | Ce qui s'affiche dans OBS (le timer) |
| `public/panel.html` | Le panneau de configuration |
| `public/sound.js` | Les sons intégrés (générés, sans fichier) |
| `public/sounds/` | Vos propres sons (.mp3…), facultatif |
| `server.js` + `lib/` | Le serveur pour les modes -athon (aucune installation `npm` nécessaire) |
| `package.json` | Description du module (aucune dépendance) |
| `data/` | Créé automatiquement : vos réglages, votre clé et l'état du timer. **Ne le partagez jamais.** |

---

## 1. Starting Soon hors ligne (sans serveur)

1. Téléchargez ce dépôt sur votre PC. Sur GitHub : **Code → Download ZIP**, puis décompressez.
2. Double-cliquez sur `public/panel.html`. Il s'ouvre dans votre navigateur en **mode hors ligne**.
3. Réglez la durée (ou une heure fixe, par exemple 20:00) et les textes. Le bouton **« Mettre mon image de fond »** montre l'aperçu sur votre image Starting Soon.
4. Cliquez sur **Copier**.
5. Dans OBS, sur la scène Starting Soon :
   - **+ → Navigateur** ;
   - **décochez « Fichier local »** et collez l'adresse dans **URL** ;
   - largeur **1200**, hauteur **330** ;
   - cochez **« Contrôler l'audio via OBS »** si vous avez choisi un son de fin.

   Le compte à rebours repart tout seul du début à chaque fois que la scène passe à l'antenne.
6. Placez la source sous « follow for more ».

Le fond est transparent : seuls le texte et le timer apparaissent par-dessus votre image. Les polices sont intégrées, donc rien n'est téléchargé.

> Si vous déplacez le dossier sur votre PC, recopiez l'adresse depuis `panel.html`.

---

## 2. Installer le serveur sur votre bot Discord (Sparked Host)

Le serveur n'a **aucune dépendance** : il suffit de copier les fichiers. Il faut Node.js 16.14 ou plus récent (discord.js v14 en demande déjà autant).

### a) Copier les fichiers

Dans le panneau Sparked Host, onglet **Files**, créez un dossier **`timer`** à la racine du bot, à côté de `index.js` et de `wishlist/`. Envoyez-y tout le contenu de ce dépôt :

```
index.js
wishlist/
timer/
├── server.js
├── package.json
├── lib/        (3 fichiers)
└── public/     (overlay.html, panel.html, fonts.css)
```

`timer/data/` se créera tout seul au premier démarrage.

### b) Brancher le timer sur le serveur web de la wishlist

Votre bot lance déjà un serveur web avec `require('./wishlist/server.js')`, et il occupe le seul port de votre serveur Sparked Host. Le timer se branche donc **sur ce même serveur**, sous l'adresse `/timer`.

Dans **`wishlist/server.js`**, deux ajouts :

1. En haut, sous `const crypto = require('crypto');` :

```js
const lunariaTimer = require('../timer/server.js').middleware(); // 🌙 Lunaria Timer → /timer
```

2. Juste sous `const server = http.createServer(async (req, res) => {` :

```js
  // 🌙 Lunaria Timer : les adresses /timer/... sont gérées par le timer
  let timerHandled = true;
  lunariaTimer(req, res, () => { timerHandled = false; });
  if (timerHandled) return;
```

Vous n'avez **rien à changer dans `index.js`** : le timer démarre avec la wishlist.

> Avec un serveur Express, une seule ligne suffit : `app.use(require('../timer/server.js').middleware());`.

### c) Redémarrer et récupérer la clé

Redémarrez le bot. Dans la console apparaît :

```
[Lunaria] Clé du panneau (à garder secrète) : Ab3xY…
```

**Notez la clé** : c'est le mot de passe du panneau. Elle n'est affichée qu'au premier démarrage. Vous la retrouverez ensuite dans `timer/data/config.json`, champ `adminKey`.

### d) Les adresses

Ce sont les mêmes IP et port que votre wishlist (visibles dans l'onglet **Network** de Sparked Host). Par exemple, pour `123.45.67.89:25571` :

- Panneau : `http://123.45.67.89:25571/timer/panel`
- OBS : `http://123.45.67.89:25571/timer/overlay`

## 3. Relier StreamElements

1. Allez sur [streamelements.com → Account → Channels](https://streamelements.com/dashboard/account/channels).
2. Cliquez sur **Show secrets** et copiez le **JWT Token**. Ne le montrez jamais en stream.
3. Dans le panneau Lunaria, section **StreamElements** : collez le jeton puis cliquez sur **Enregistrer**.
4. Le voyant passe au vert : **connecté**.

Le panneau ne réaffiche jamais le jeton une fois enregistré : vous pouvez ouvrir le panneau en stream sans risque. Le serveur reste connecté en permanence et compte les subs même si OBS plante.

---

## 4. Utiliser le panneau

- **Mode** : Starting Soon, Lunariathon, Subathon ou Donathon.
  - Passer du Starting Soon à un -athon remet le timer à sa durée de départ.
  - Passer d'un -athon à un autre (par exemple de Subathon à Lunariathon) garde le temps en cours.
- **Ce qui ajoute du temps** : dans chaque mode, cochez les subs, subs offerts, dons et bits qui comptent.
  - Par défaut, le **Lunariathon** compte tout, le **Subathon** les subs et le **Donathon** les dons et les bits.
- **Temps ajouté** :
  - par tier : T1, T2, T3 et Prime ;
  - un sub offert rapporte le même temps qu'un sub du même tier ;
  - les dons et les bits sont proportionnels : avec 1 min par 1 €, un don de 7,50 € donne 7 min 30 s ;
  - un don minimum peut être fixé.
- **Pleine lune** : un bonus ×1,5, ×2 ou ×3 sur tous les événements. Il s'affiche sur le stream.
- **Durée totale maximale** : pour qu'un -athon ne dure pas plus de X heures.
- **Boutons ±** : ajouter ou retirer du temps à la main. **Régler le temps** accepte `1:30:00`, `45:00` ou `90` (minutes).
- **Tester** : simule des subs, dons et bits pour vérifier l'affichage avant le live. Attention, cela ajoute vraiment du temps.
- **Journal** : chaque événement, avec le temps ajouté.

Dans OBS, une seule source suffit pour tous les modes : `http://ip:port/timer/overlay`. Taille conseillée : 1200 × 330 sur l'écran Starting Soon, 1200 × 450 sur la scène du -athon. Si la source est plus petite, le timer se réduit tout seul pour tenir dedans.

Le timer est sauvegardé en continu. Si le bot redémarre pendant un Lunariathon, le temps continue de s'écouler normalement.

---

## 5. Sons, effets et personnalisation

Tout se règle dans le panneau et s'applique en direct.

- **Démarrage automatique du Starting Soon** (section Mode) : le compte à rebours se lance dès que la scène passe à l'antenne dans OBS. Option : repartir du début à chaque affichage.
- **Pause** : le bouton **Pause / Reprendre** fige le timer, en Starting Soon comme en -athon. « en pause » s'affiche sur le stream (texte modifiable). Les subs et dons reçus pendant la pause ajoutent quand même du temps.
- **Mode Personnalisé** : un 4e -athon avec le nom de votre choix (champ « Titre affiché ») et ses propres règles.
- **Subs offerts groupés** : « Pseudo offre 20 subs » donne **une seule** notification « +1 h 40 · Pseudo · 20 subs offerts », même si StreamElements envoie les 20 subs un par un. Il y a environ 3 secondes d'attente, le temps de tous les recevoir.
- **Sons** : un son quand du temps est ajouté (tic-tac d'horloge, carillon, cristal, poussière magique) et un son de fin, séparé pour le Starting Soon et pour les -athon (cloches, harpe, gong, fanfare, horloge). Le bouton ▶ permet d'écouter. Pour utiliser vos propres sons, déposez des `.mp3` dans `timer/public/sounds/` puis cliquez sur « Actualiser la liste ».
  > Dans OBS, cochez **« Contrôler l'audio via OBS »** dans la source navigateur, sinon le son ne passe pas sur le stream.
- **Effets de fin** : pluie d'étoiles, étoiles filantes, gerbe d'étincelles ou halo lunaire (bouton « Voir » pour l'aperçu).
- **Effets pendant le timer** : animation des chiffres (fondu, glissé, bascule), lueur qui respire, poussière d'étoiles, étoiles de chaque côté, 10 dernières secondes qui battent, étincelles ou éclat quand du temps est ajouté.
- **Tailles** : réglables séparément pour le timer, le titre, les textes, les règles, le « +5 min » et le texte de fin.
- **Position et plein écran** : les effets restent dans le cadre de la source OBS. Pour qu'ils couvrent tout l'écran, donnez à la source la taille **1920 × 1080** en plein écran, puis placez le timer avec les curseurs « Position ».
- **Noms affichés** : renommez Sub, Don, bits, Prime… (par exemple « Éclats de lune » à la place de « bits »). Les nouveaux noms sont utilisés sur le stream et dans le journal.
- **Tests** (section Tester) : choisissez si les tests ajoutent du temps et s'ils comptent dans les statistiques.

---

## 6. Ajouter du temps depuis votre bot Discord

Depuis le code du bot :

```js
const { lunaria } = require('./timer/server.js'); // depuis un fichier à la racine du bot

lunaria.addTime(300, 'Bonus Discord');                    // +5 min (négatif pour retirer)
lunaria.event({ type: 'sub', tier: '1', user: 'Pseudo' }); // comme un vrai sub T1
lunaria.event({ type: 'tip', amount: 10, user: 'Pseudo' }); // comme un don de 10 €
lunaria.pause();  lunaria.resume();                        // pause / reprise
lunaria.remainingSeconds();                                // temps restant
```

Exemple de commande slash avec discord.js v14 :

```js
// Déclaration : new SlashCommandBuilder().setName('timer').setDescription('Ajouter du temps')
//   .addIntegerOption(o => o.setName('minutes').setDescription('Minutes').setRequired(true))
if (interaction.commandName === 'timer') {
  const minutes = interaction.options.getInteger('minutes');
  lunaria.addTime(minutes * 60, interaction.user.username);
  await interaction.reply(`☾ +${minutes} min ! Il reste ${Math.round(lunaria.remainingSeconds() / 60)} min.`);
}
```

Vous pouvez aussi appeler l'API HTTP (`http://ip:port/timer/api/event`), avec l'en-tête `x-lunaria-key: VOTRE_CLÉ` :

```
POST /api/event   {"seconds": 300, "note": "Bonus"}
POST /api/event   {"type": "sub", "tier": "2", "user": "Pseudo"}
POST /api/event   {"type": "gift", "tier": "1", "count": 5, "user": "Pseudo"}
POST /api/event   {"type": "bits", "amount": 500, "user": "Pseudo"}
POST /api/event   {"type": "tip", "amount": 10, "user": "Pseudo"}
POST /api/event   {"action": "pause"}      (ou "resume")
```

---

## Mettre à jour le timer

Remplacez `server.js`, `lib/` et `public/` dans `timer/` (Files de Sparked Host), puis redémarrez le bot. Ne touchez pas au dossier `timer/data/` : il contient vos réglages, votre clé et le timer en cours.

---

## Bon à savoir

- **Sécurité** :
  - le panneau est protégé par la clé ; après 8 essais ratés, l'adresse IP est bloquée 5 minutes ;
  - la connexion se fait en `http` (pas de cadenas) : évitez d'ouvrir le panneau sur un Wi-Fi public ;
  - la page `/overlay` ne contient aucun secret.
- **Changer la clé** : modifiez `adminKey` dans `timer/data/config.json`, puis redémarrez le bot.
- **Tout remettre à zéro** : arrêtez le bot et supprimez le dossier `timer/data/`.
- **Variables d'environnement** (facultatives) :
  - `LUNARIA_PORT` : port à utiliser si le timer a son propre port ;
  - `LUNARIA_ADMIN_KEY` : clé du panneau ;
  - `STREAMELEMENTS_JWT` : jeton StreamElements ;
  - `LUNARIA_DATA_DIR` : dossier des données.
- **Serveur seul, sans bot** : lancez `node server.js` dans ce dossier.

Polices : Cinzel et Allura (SIL Open Font License), intégrées dans `public/fonts.css`.
