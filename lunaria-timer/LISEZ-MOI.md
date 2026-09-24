# Lunaria Timer ☾

Un timer pour OBS aux couleurs de Lunaria. Il a deux usages :

1. **Starting Soon (hors ligne)** : un compte à rebours avant le début du stream. Il marche sans Internet et sans serveur, directement depuis votre PC.
2. **Lunariathon, Subathon et Donathon** : le timer augmente tout seul à chaque sub (T1, T2, T3, Prime), sub offert, don et bits reçu via StreamElements. Tout se règle depuis un panneau web. Le serveur tourne sur votre bot Discord (Sparked Host).

| Fichier | Rôle |
| --- | --- |
| `public/overlay.html` | Ce qui s'affiche dans OBS (le timer) |
| `public/panel.html` | Le panneau de configuration |
| `server.js` + `lib/` | Le serveur pour les modes -athon (aucune installation `npm` nécessaire) |
| `data/` | Créé automatiquement : vos réglages, votre clé et l'état du timer. **Ne le partagez jamais.** |

---

## 1. Starting Soon hors ligne (sans serveur)

1. Téléchargez le dossier `lunaria-timer` sur votre PC. Sur GitHub : **Code → Download ZIP**, puis décompressez.
2. Double-cliquez sur `public/panel.html`. Il s'ouvre dans votre navigateur en **mode hors ligne**.
3. Réglez la durée (ou une heure fixe, par exemple 20:00) et les textes. Le bouton **« Mettre mon image de fond »** montre l'aperçu sur votre image Starting Soon.
4. Cliquez sur **Copier**.
5. Dans OBS, sur la scène Starting Soon :
   - **+ → Navigateur** ;
   - **décochez « Fichier local »** et collez l'adresse dans **URL** ;
   - largeur **1200**, hauteur **330** ;
   - cochez **« Actualiser le navigateur quand la scène devient active »**. Le compte à rebours repart ainsi à chaque fois que vous affichez la scène.
6. Placez la source sous « follow for more ».

Le fond est transparent : seuls le texte et le timer apparaissent par-dessus votre image. Les polices sont intégrées, donc rien n'est téléchargé.

> Si vous déplacez le dossier sur votre PC, recopiez l'adresse depuis `panel.html`.

---

## 2. Installer le serveur sur votre bot Discord (Sparked Host)

Le serveur n'a **aucune dépendance** : il suffit de copier les fichiers. Il faut Node.js 16.14 ou plus récent (discord.js v14 en demande déjà autant).

### a) Copier les fichiers

Dans le panneau Sparked Host, onglet **Files** :

1. Créez un dossier `lunaria-timer` à côté du fichier principal de votre bot (souvent `index.js`).
2. Envoyez-y **tout le contenu** de ce dossier : `server.js`, `package.json`, `lib/` et `public/`.

### b) Le démarrer avec votre bot

Ouvrez le fichier principal du bot et ajoutez **tout en haut** :

```js
require('./lunaria-timer/server.js');
```

Si votre bot utilise `import` au lieu de `require` :

```js
import './lunaria-timer/server.js';
```

Redémarrez le bot. Dans la **console**, vous verrez :

```
[Lunaria] Serveur lancé sur le port 25571
[Lunaria]   Clé du panneau (à garder secrète) : Ab3xY…
```

**Notez la clé** : c'est le mot de passe du panneau. Elle n'est affichée qu'au premier démarrage. Vous la retrouverez ensuite dans `lunaria-timer/data/config.json`, champ `adminKey`.

### c) Trouver l'adresse

Le serveur utilise automatiquement le port attribué à votre serveur Sparked Host. Vous voyez l'**IP et le port** dans le panneau Sparked Host : onglet **Network**, ou en haut de la console. Exemple : `123.45.67.89:25571`.

- Panneau : `http://123.45.67.89:25571/panel`
- OBS : `http://123.45.67.89:25571/overlay`

> Votre bot utilise déjà ce port pour un site web ? Choisissez un autre port avec la variable d'environnement `LUNARIA_PORT`. Ce port doit aussi être ouvert dans Sparked Host (onglet Network).

---

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

Dans OBS, une seule source suffit pour tous les modes : `http://ip:port/overlay`. Taille conseillée : 1200 × 330 sur l'écran Starting Soon, 1200 × 450 sur la scène du -athon. Si la source est plus petite, le timer se réduit tout seul pour tenir dedans.

Le timer est sauvegardé en continu. Si le bot redémarre pendant un Lunariathon, le temps continue de s'écouler normalement.

---

## 5. Ajouter du temps depuis votre bot Discord

Depuis le code du bot :

```js
const { lunaria } = require('./lunaria-timer/server.js');

lunaria.addTime(300, 'Bonus Discord');                    // +5 min (négatif pour retirer)
lunaria.event({ type: 'sub', tier: '1', user: 'Pseudo' }); // comme un vrai sub T1
lunaria.event({ type: 'tip', amount: 10, user: 'Pseudo' }); // comme un don de 10 €
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

Vous pouvez aussi appeler l'API HTTP, avec l'en-tête `x-lunaria-key: VOTRE_CLÉ` :

```
POST /api/event   {"seconds": 300, "note": "Bonus"}
POST /api/event   {"type": "sub", "tier": "2", "user": "Pseudo"}
POST /api/event   {"type": "gift", "tier": "1", "count": 5, "user": "Pseudo"}
POST /api/event   {"type": "bits", "amount": 500, "user": "Pseudo"}
POST /api/event   {"type": "tip", "amount": 10, "user": "Pseudo"}
```

---

## Bon à savoir

- **Sécurité** :
  - le panneau est protégé par la clé ; après 8 essais ratés, l'adresse IP est bloquée 5 minutes ;
  - la connexion se fait en `http` (pas de cadenas) : évitez d'ouvrir le panneau sur un Wi-Fi public ;
  - la page `/overlay` ne contient aucun secret.
- **Changer la clé** : modifiez `adminKey` dans `data/config.json`, puis redémarrez le bot.
- **Tout remettre à zéro** : arrêtez le bot et supprimez le dossier `data/`.
- **Variables d'environnement** (facultatives) :
  - `LUNARIA_PORT` : port à utiliser ;
  - `LUNARIA_ADMIN_KEY` : clé du panneau ;
  - `STREAMELEMENTS_JWT` : jeton StreamElements ;
  - `LUNARIA_DATA_DIR` : dossier des données.
- **Serveur seul, sans bot** : lancez `node server.js` dans ce dossier.

Polices : Cinzel et Allura (SIL Open Font License), intégrées dans `public/fonts.css`.
