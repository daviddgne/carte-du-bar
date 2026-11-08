# Carte du bar

Carte des bières pour l'équipe, à consulter d'un coup d'œil sur téléphone.
On touche des boutons dans les mots du client (goût, type, force, ce qu'il boit d'habitude) ou on choisit un plat du menu.

- **`index.html`** : la vue équipe (lien public, en français et en anglais).
- **`admin.html`** : l'administration (établissements, fiches produits, recettes, listes, publication).

Le site est entièrement statique, hébergé gratuitement sur GitHub Pages, sans serveur ni base de données.
Les données sont des fichiers JSON dans `data/` et les photos sont dans `images/`.

---

## 1. Mettre le site en ligne (une seule fois)

1. **Créer le dépôt.** Sur [github.com/new](https://github.com/new), nommez-le par exemple `carte-du-bar` et choisissez **Public**.
   Avec un compte GitHub gratuit, GitHub Pages ne fonctionne qu'avec un dépôt public.
2. **Envoyer les fichiers.** Dans le dépôt, choisissez **Add file › Upload files**, puis glissez-déposez :
   `index.html`, `admin.html`, `manifest.webmanifest`, `sw.js`, `README.md` et les dossiers `css`, `js`, `data`, `icons`.
   N'envoyez pas le dossier `.claude`. Validez avec **Commit changes**.
3. **Activer GitHub Pages.** Allez dans **Settings › Pages**, puis **Source : Deploy from a branch**, branche `main`, dossier `/ (root)`, et **Save**.
   Après une à deux minutes, le site est disponible à l'adresse :
   `https://VOTRE-IDENTIFIANT.github.io/carte-du-bar/`
4. **Relier l'administration au dépôt.**
   - Créez un jeton : [Settings › Developer settings › Fine-grained tokens › Generate new token](https://github.com/settings/personal-access-tokens/new).
     - *Repository access* : **Only select repositories**, puis votre dépôt.
     - *Permissions › Repository › Contents* : **Read and write**. Ne cochez rien d'autre.
   - Ouvrez `https://VOTRE-IDENTIFIANT.github.io/carte-du-bar/admin.html`, puis l'onglet **Paramètres**. Saisissez l'identifiant, le dépôt, la branche `main` et le jeton, puis cliquez sur **Enregistrer et tester**.
   - Faites cette étape sur chaque appareil (ordinateur, téléphone) depuis lequel vous voulez administrer.

## 2. Utilisation au quotidien

1. Dans `admin.html`, choisissez l'établissement en haut de la page.
2. Créez ou modifiez une fiche, puis cliquez sur **Enregistrer**.
   Les modifications sont gardées dans le navigateur : rien n'est perdu si la page se ferme.
3. **Aperçu** montre le site avec vos modifications avant de les publier.
4. **Publier** envoie tout en une seule fois sur GitHub. Le site public est à jour une à deux minutes plus tard.

Quelques fonctions utiles :

- **Boutons de recherche** : chaque fiche indique son type, son amertume, ses goûts et « Il boit d'habitude ». La force se calcule toute seule à partir du % d'alcool.
- **Onglet Menu & accords** : liste les plats de chaque pub, avec les bières qui vont avec et la raison.
- **Onglet Listes** : renomme, traduit et réordonne les arômes, styles, provenances et boutons.
- **Photos** : sur téléphone, « Choisir / photographier » ouvre l'appareil photo.
  Les images sont réduites automatiquement (environ 1400 px) avant l'envoi.
- **Cocktails** : méthode, verre, glace, ingrédients avec dosages, étapes, décoration et notes pour l'équipe.
  Si vous tapez le nom exact d'un produit du catalogue comme ingrédient, il devient cliquable dans la fiche.
- **Sauvegarde** : l'onglet Paramètres permet d'exporter ou d'importer toutes les données dans un fichier JSON.

## 3. Installer sur le téléphone

- **iPhone (Safari)** : bouton Partager, puis **Sur l'écran d'accueil**.
- **Android (Chrome)** : menu ⋮, puis **Installer l'application** (ou **Ajouter à l'écran d'accueil**).

La carte reste consultable hors connexion, dans sa dernière version vue en ligne.

## 4. Sécurité

- La page `admin.html` est visible par tous, mais elle ne peut rien modifier sans le jeton.
- Le jeton n'est enregistré que dans le navigateur où vous l'avez saisi, jamais dans le dépôt.
  En cas de perte d'un appareil, révoquez le jeton sur GitHub et créez-en un nouveau.

## 5. Prochaine étape : l'assistant IA (pas encore activé)

- Un bouton « Pré-remplir avec l'IA » remplira une fiche à partir du nom et du producteur (type, arômes, alcool, IBU, notes).
- L'assistant suggérera aussi des cocktails ou des accords à partir de ce qui est en inventaire.
- Il passera par l'API Claude, avec une clé saisie dans Paramètres et gardée dans le navigateur de l'administrateur.

## Structure

```
index.html            vue équipe
admin.html            administration
css/                  styles (app.css partagé, admin.css)
js/core.js            outils communs
js/i18n.js            textes FR/EN, seuils de force, unités
js/public.js          vue équipe
js/admin.js           administration
js/github.js          lecture/écriture dans le dépôt (API GitHub)
data/config.json      nom du site et liste des établissements
data/vocabulaire.json listes de pastilles (styles, arômes, accords, allergènes…)
data/etablissements/  un fichier de produits par établissement
images/               photos (créé à la première publication d'une image)
```
