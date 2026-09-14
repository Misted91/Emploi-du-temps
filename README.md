# 🗓️ Mon emploi du temps

Un petit site web pour **créer et personnaliser son emploi du temps** de la semaine, sans installation ni serveur. Tout fonctionne dans le navigateur.

## Fonctionnalités

- **Grille hebdomadaire** avec les heures en ligne et les jours en colonne.
- **Ajout / modification / suppression de cours** en un clic sur une case.
- Pour chaque cours : matière, salle ou prof, heure de début et de fin, couleur.
- **Réglages de la grille** : heure de début et de fin, durée des créneaux (30 min ou 1 h), et choix des jours affichés (du lundi au dimanche).
- **Sauvegarde automatique** dans le navigateur (`localStorage`).
- **Exporter / Importer** l'emploi du temps au format JSON pour le sauvegarder ou le partager.
- **Impression / PDF** via le bouton Imprimer.
- Interface **responsive** (ordinateur, tablette, mobile).

## Utilisation

Ouvre simplement `index.html` dans ton navigateur — aucune dépendance à installer.

Pour le mettre en ligne, tu peux l'héberger sur n'importe quel hébergement de fichiers statiques (GitHub Pages, Netlify, etc.).

## Structure

| Fichier | Rôle |
|---------|------|
| `index.html` | Structure de la page et des fenêtres modales |
| `style.css`  | Mise en forme et responsive |
| `app.js`     | Logique : grille, cours, réglages, import/export |
