# SgrunfRunner

An endless runner web game developed for SarnanoComix.

[Play now on Github Pages](https://derefdev.github.io/SgrunfRunner)

![Last commit](https://img.shields.io/github/last-commit/DerefDev/SgrunfRunner?style=for-the-badge&logo=github) ![License](https://img.shields.io/badge/license-GPL-green?style=for-the-badge)

## 📑 Table of Contents

- [Description](#-description)
- [Key Features](#-key-features)
- [Use Cases](#-use-cases)
- [Project Structure](#-project-structure)
- [Credits](#-credits)
- [License](#-license)

## 📝 Description

SgrunfRunner is a browser-based endless runner game designed specifically for the SarnanoComix 2026 event. The game offers an interactive, lightweight arcade experience accessible on modern web browsers without requiring complex setups or console hardware. It provides users with an immediate, responsive gameplay interface built entirely on standard frontend web technologies. The code architecture divides different thematic environments into distinct modules, notably containing dedicated configurations for a cyberpunk mode and a fantasy mode. Game logic and styling are structured across split source files to maintain clear separation of concerns, utilizing standard HTML5 canvas elements or DOM structures to render dynamic runner mechanics. For developers or event organizers, it serves as a straightforward template for deploying themed web games.

## ✨ Key Features

- **🎮 Thematic Game Modes** — Includes separate gameplay modes and configurations for Cyberpunk and Fantasy environments.
- **🌐 Pure Web Stack** — Runs entirely in-browser using standard HTML, CSS, and JavaScript files without heavy framework dependencies.

## 🎯 Use Cases

- Providing a quick-to-play, interactive web game for SarnanoComix event promotion.
- Serving as a modular template for developers building basic multi-theme endless runner games in vanilla JavaScript.

## 📁 Project Structure

```
├── .github
│   └── workflows
│       └── keep-alive.yml
├── LICENSE
├── README.md
├── ModalitaCyberpunk
│   ├── assets
│   │   ├── OstacoliCyberpunk_Spritesheet.json
│   │   ├── SgrunfCyberpunk_Spritesheet.json
│   │   ├── png
│   │   │   ├── CyberpunkBg_1.png
│   │   │   ├── CyberpunkBg_2.png
│   │   │   ├── CyberpunkBg_3.png
│   │   │   ├── CyberpunkBg_4.png
│   │   │   ├── CyberpunkBg_5.png
│   │   │   ├── OstacoliCyberpunk_Spritesheet.png
│   │   │   └── SgrunfCyberpunk_Spritesheet.png
│   │   └── sounds
│   │       ├── dead.mp3
│   │       ├── jump.mp3
│   │       └── theme.mp3
│   ├── cyberpunk.css
│   ├── cyberpunk.js
│   └── index.html
├── ModalitaFantasy
│   ├── assets
│   │   ├── json
│   │   │   ├── FireBallBlack.json
│   │   │   ├── FireBallBlue.json
│   │   │   ├── OmbraFantasyFluttua_Spritesheet.json
│   │   │   ├── OmbraFantasySpara_Spritesheet.json
│   │   │   ├── OstacoliFantasy_Spritesheet.json
│   │   │   └── SgrunfFantasy_Spritesheet.json
│   │   ├── png
│   │   │   ├── FantasyBg_1.png
│   │   │   ├── FantasyBg_2.png
│   │   │   ├── FantasyBg_3.png
│   │   │   ├── FantasyBg_4.png
│   │   │   ├── FantasyBg_5.png
│   │   │   ├── FantasyBg_6.png
│   │   │   ├── FireBallBlack.png
│   │   │   ├── FireBallBlue.png
│   │   │   ├── OmbraFantasyFluttua_Spritesheet.png
│   │   │   ├── OmbraFantasySpara_Spritesheet.png
│   │   │   ├── OstacoliFantasy_Spritesheet.png
│   │   │   └── SgrunfFantasy_Spritesheet.png
│   │   └── sounds
│   │       ├── FireballBlack.mp3
│   │       ├── FireballBlue.mp3
│   │       ├── bossTheme.mp3
│   │       ├── dead.mp3
│   │       ├── jump.mp3
│   │       └── theme.mp3
│   ├── fantasy.css
│   ├── fantasy.js
│   └── index.html
├── assets
│   ├── CyberpunkVideo.mp4
│   ├── FantasyVideo.mp4
│   ├── SgrunfCyberPunk_Statico.png
│   ├── SgrunfFantasy_Statico.png
│   ├── githubLogo.svg
│   ├── sfondoCyberpunk.png
│   └── sfondoFantasy.png
├── index.html
├── split.css
└── split.js
```

## 📥 Credits

Some visual assets used in this project are based on or derived from the following asset packs:

- [Warped City — by Ansimuz](https://ansimuz.itch.io/warped-city)
- [Night City — by Stext25](https://stext25.itch.io/night-city)
- [Ancient Forest — by Sismodyn](https://sismodyn.itch.io/ancientforest)

All rights to the original assets belong to their respective creators.  
Assets may have been modified or adapted for this project.

## 📜 License

This project is licensed under the **GPL** License.
