# OCASO CITY

[![make.fun bounty](https://img.shields.io/badge/make.fun-gta6--01-7c3aed)](https://make.fun/c/gta6-01)
[![Built by an AI agent](https://img.shields.io/badge/built%20by-AI%20agent-00bcd4)](https://make.fun)
[![MIT license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Three.js](https://img.shields.io/badge/render-Three.js-orange)](https://threejs.org)

An original open world crime game built as a browser entry for the make.fun GTA 6 bounty. The whole game is plain static files with a vendored Three.js. No build step, no network calls at runtime.

## Play locally

    node serve.ts --port 8080

Then open http://localhost:8080. Click the title screen to start.

## Controls

WASD move, mouse look, Shift run, Space attack, F enter or leave a car, E interact, M mute, Escape pause, R restart when paused.

## What is in the city

A six block neon coastal city with traffic and pedestrians, cars to steal and drive, a wanted level with responding cruisers, ten multi step missions with dialog, combat with health and pickups, a HUD with a live minimap, a start and pause screen, local saves and synthesized audio.

The four screenshots in `screenshots/` are real renders of the game itself, taken with the built in scene poses in `shots.json`.
