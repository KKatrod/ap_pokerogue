@echo off
rem PokeRogue Archipelago: starts the game with the node.exe of the "node" folder (no installation needed)
rem and opens it in the default browser. Keep this window open while playing.
title PokeRogue
"%~dp0node\node.exe" "%~dp0serve.mjs"
if errorlevel 1 pause
