function main() {
    let cvs = document.querySelector("#viewport-canvas");
    let glWindow = new GLWindow(cvs);

    if (!glWindow.ok()) return;

    let place = new Place(glWindow);
    place.initConnection();
    GUI(cvs, glWindow, place);
}

const GUI = (cvs, glWindow, place) => {
    let color = new Uint8Array([0, 0, 0]);
    let dragdown = false;
    let lastMovePos = {x: 0, y: 0};
    let touchstartTime;
    
    // Variables pour la sélection de pixels individuels
    let isSelecting = false;
    let selectedPixels = new Set(); // Utilise un Set pour éviter les doublons
    let selectionOverlays = []; // Array pour stocker tous les overlays de pixels sélectionnés
    let isSelectionDragging = false;

    const colorField = document.querySelector("#color-field");
    const colorPreset = document.querySelector("#color-preset");
    const colorSwatch = document.querySelector("#color-swatch");

    document.addEventListener("keydown", ev => {
        switch (ev.code) {
            case "PageDown":
            case "NumpadSubtract":
                ev.preventDefault();
                zoomOut(1.2);
                break;
            case "PageUp":
            case "NumpadAdd":
                ev.preventDefault();
                zoomIn(1.2);
                break;
            case "KeyP":
                const pos = glWindow.click(lastMovePos);
                console.log("Current mouse position:", parseInt(pos.x), parseInt(pos.y));
                break;
            case "Escape":
                if (isSelecting) {
                    cancelSelection();
                }
                break;
        }
    });

    window.addEventListener("wheel", ev => {
        ev.preventDefault();
        if (ev.deltaY > 0) {
            zoomOut(1.05);
        } else {
            zoomIn(1.05);
        }
    }, { passive: false });

    document.querySelector("#zoom-in").addEventListener("click", () => {
        zoomIn(1.2);
    });

    document.querySelector("#zoom-out").addEventListener("click", () => {
        zoomOut(1.2);
    });

    document.querySelector("#grid-enable").addEventListener("click", () => {
        glWindow.setGrid(!glWindow.getGrid());
        glWindow.draw();
    });

    window.addEventListener("resize", ev => {
        glWindow.updateViewScale();
        glWindow.draw();
        if (isSelecting) {
            updateAllSelectionOverlays();
        }
    });

    cvs.addEventListener("mousedown", (ev) => {
        const pos = {x: ev.clientX, y: ev.clientY};
        
        if (isSelecting) {
            // Mode sélection - commencer à peindre la sélection
            isSelectionDragging = true;
            selectPixelAtPosition(pos);
            return;
        }
        
        switch (ev.button) {
            case 0:
                dragdown = true;
                lastMovePos = pos;
                break;
            case 1:
                pickColor(pos);
                break;
            case 2:
                dragdown = true;
                if (ev.ctrlKey) {
                    pickColor(pos);
                } else {
                    drawPixel(pos, color);
                }
        }
    });

    document.addEventListener("mouseup", (ev) => {
        if (isSelecting && isSelectionDragging) {
            isSelectionDragging = false;
            if (selectedPixels.size > 0) {
                showValidateButton();
            }
            return;
        }
        
        dragdown = false;
        document.body.style.cursor = "auto";
    });

    document.addEventListener("mousemove", (ev) => {
        const movePos = {x: ev.clientX, y: ev.clientY};
        
        if (isSelecting && isSelectionDragging) {
            // Continuer à peindre la sélection pendant le glissement
            selectPixelAtPosition(movePos);
            return;
        }
        
        if (dragdown) {
            if (ev.buttons === 2) {
                if (ev.ctrlKey) {
                    pickColor(movePos);
                } else {
                    drawPixel(movePos, color);
                }
            } else {
                glWindow.move(movePos.x - lastMovePos.x, movePos.y - lastMovePos.y);
                glWindow.draw();
                document.body.style.cursor = "grab";
                
                // Mettre à jour les overlays pendant le déplacement
                if (isSelecting) {
                    updateAllSelectionOverlays();
                }
            }
        }
        lastMovePos = movePos;
    });

    cvs.addEventListener("touchstart", (ev) => {
        touchstartTime = (new Date()).getTime();
        lastMovePos = {x: ev.touches[0].clientX, y: ev.touches[0].clientY};
    });

    if (!place.mobile)
        document.addEventListener("touchend", (ev) => {
            let elapsed = (new Date()).getTime() - touchstartTime;
            if (elapsed < 100) {
                if (isSelecting) {
                    selectPixelAtPosition(lastMovePos);
                } else {
                    drawPixel(lastMovePos, color);
                }
            }
        });

    document.addEventListener("touchmove", (ev) => {
        let movePos = {x: ev.touches[0].clientX, y: ev.touches[0].clientY};
        
        if (isSelecting) {
            // En mode sélection sur mobile
            selectPixelAtPosition(movePos);
        } else {
            glWindow.move(movePos.x - lastMovePos.x, movePos.y - lastMovePos.y);
            glWindow.draw();
            
            // Mettre à jour les overlays pendant le déplacement
            if (isSelecting) {
                updateAllSelectionOverlays();
            }
        }
        lastMovePos = movePos;
    });

    cvs.addEventListener("contextmenu", () => {
        return false;
    });

    colorField.addEventListener("change", ev => setColor(colorField.value));

    const presets = {
        "#000000": "noir",
        "#333434": "gris",
        "#d4d7d9": "gris clair",
        "#ffffff": "blanc",
        "#6d302f": "maron",
        "#6d001a": "rouge marronâtre",
        "#9c451a": "maron clair",
        "#be0027": "rouge",
        "#ff2651": "rouge clair",
        "#ff2d00": "rouge",
        "#ffa800": "orange foncé",
        "#ffd623": "jaune",
        "#fff8b8": "beige",
        "#7eed38": "vert clair",
        "#00cc4e": "vert",
        "#00a344": "vert foncé",
        "#598d5a": "vert foncé foncé",
        "#004b6f": "bleu sous marin",
        "#009eaa": "bleu marin",
        "#00ccc0": "bleu sale de bain",
        "#33E9F4": "cian",
        "#5eb3ff": "bleu evian",
        "#245aea": "bleu ciel",
        "#313ac1": "bleu ciel violet",
        "#1832a4": "ciel violet foncé",
        "#511e9f": "violet",
        "#6a5cff": "violet clair",
        "#b44ac0": "violet clair rose",
        "#ff63aa": "rose",
        "#e4abff": "rose clair",
    };
    console.debug("color presets", presets);
    Object.entries(presets).forEach(([key, value]) => {
        let element = document.createElement("button");
        colorPreset.appendChild(element);
        element.setAttribute('data-color', key);
        element.setAttribute("title", value);
        element.style.backgroundColor = key;
        element.addEventListener("click", ev => setColor(ev.target.getAttribute('data-color')));
    });

    // ***************************************************
    // ***************************************************
    // Selection Functions (mode peinture) - VERSION SIMPLIFIÉE
    //
    const startSelection = () => {
        isSelecting = true;
        document.body.style.cursor = "crosshair";
        console.log("Mode sélection activé - cliquez et glissez pour sélectionner des pixels");
    };

    const cancelSelection = () => {
        isSelecting = false;
        isSelectionDragging = false;
        selectedPixels.clear();
        document.body.style.cursor = "auto";
        hideValidateButton();
        removeAllSelectionOverlays();
        console.log("Sélection annulée");
    };

    const selectPixelAtPosition = (screenPos) => {
        // Utiliser EXACTEMENT la même logique que drawPixel
        const canvasPos = glWindow.click(screenPos);
        
        // Si glWindow.click retourne null, c'est que le clic est en dehors du canvas
        if (!canvasPos) return;

        const x = Math.floor(canvasPos.x);
        const y = Math.floor(canvasPos.y);
        const pixelKey = `${x},${y}`;

        if (!selectedPixels.has(pixelKey)) {
            selectedPixels.add(pixelKey);
            // Au lieu de créer un overlay complexe, on dessine temporairement un contour
            drawTemporaryPixelBorder(x, y);
            console.log(`Pixel sélectionné: (${x}, ${y})`);
        }
    };

    // Solution simple : créer un overlay qui suit exactement les pixels
    const drawTemporaryPixelBorder = (x, y) => {
        // Créer un petit carré qui suit exactement le pixel
        const overlay = document.createElement('div');
        overlay.className = 'pixel-selection-overlay';
        overlay.style.cssText = `
            position: absolute;
            border: 2px solid #00ff00;
            background-color: rgba(0, 255, 0, 0.3);
            pointer-events: none;
            z-index: 1000;
            box-sizing: border-box;
        `;
        overlay.dataset.pixelX = x;
        overlay.dataset.pixelY = y;
        
        document.body.appendChild(overlay);
        selectionOverlays.push(overlay);
        
        // Positionner l'overlay en utilisant une approche plus simple
        updatePixelOverlaySimple(overlay, x, y);
    };

    const updatePixelOverlaySimple = (overlay, x, y) => {
        // Créer une position fictive pour tester si le pixel est visible
        const testScreenPos = {x: cvs.offsetLeft + cvs.width/2, y: cvs.offsetTop + cvs.height/2};
        const testCanvasPos = glWindow.click(testScreenPos);
        
        if (!testCanvasPos) {
            overlay.style.display = 'none';
            return;
        }
        
        // Calculer la position relative du pixel par rapport au centre
        const centerX = testCanvasPos.x;
        const centerY = testCanvasPos.y;
        
        const zoom = glWindow.getZoom();
        const pixelSize = Math.max(2, zoom);
        
        // Position relative par rapport au centre de l'écran
        const relativeX = (x - centerX) * zoom;
        const relativeY = (y - centerY) * zoom;
        
        // Position absolue sur l'écran
        const screenX = cvs.offsetLeft + cvs.width/2 + relativeX;
        const screenY = cvs.offsetTop + cvs.height/2 + relativeY;
        
        // Vérifier si c'est dans les limites visibles
        if (screenX < cvs.offsetLeft - pixelSize || screenX > cvs.offsetLeft + cvs.width + pixelSize ||
            screenY < cvs.offsetTop - pixelSize || screenY > cvs.offsetTop + cvs.height + pixelSize) {
            overlay.style.display = 'none';
            return;
        }
        
        overlay.style.display = 'block';
        overlay.style.left = (screenX - pixelSize/2) + 'px';
        overlay.style.top = (screenY - pixelSize/2) + 'px';
        overlay.style.width = pixelSize + 'px';
        overlay.style.height = pixelSize + 'px';
    };

    const updateAllSelectionOverlays = () => {
        selectionOverlays.forEach(overlay => {
            const x = parseInt(overlay.dataset.pixelX);
            const y = parseInt(overlay.dataset.pixelY);
            updatePixelOverlaySimple(overlay, x, y);
        });
    };

    const removeAllSelectionOverlays = () => {
        selectionOverlays.forEach(overlay => {
            overlay.remove();
        });
        selectionOverlays = [];
    };

    const captureSelectedArea = () => {
        if (selectedPixels.size === 0) {
            console.log("Aucun pixel sélectionné");
            return;
        }

        const pixelData = [];
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        selectedPixels.forEach(pixelKey => {
            const [x, y] = pixelKey.split(',').map(Number);
            const color = glWindow.getColor({x, y});
            
            pixelData.push({
                x: x,
                y: y,
                color: {
                    R: color[0],
                    G: color[1],
                    B: color[2],
                    A: color[3] || 255
                }
            });

            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        });

        const selectionData = {
            timestamp: new Date().toISOString(),
            bounds: { minX, maxX, minY, maxY },
            pixels: pixelData
        };

        saveSelectionToFile(selectionData);
        cancelSelection();
        console.log(`Zone sauvegardée: ${pixelData.length} pixels`);
    };

    const saveSelectionToFile = async (data) => {
        try {
            const response = await fetch('/selections', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log(`Sélection sauvegardée avec l'ID: ${result.id}`);
            } else {
                console.error('Erreur lors de la sauvegarde:', response.statusText);
            }
        } catch (error) {
            console.error('Erreur réseau:', error);
        }
    };

    const getAllSelections = async () => {
        try {
            const response = await fetch('/selections');
            if (response.ok) {
                return await response.json();
            }
            return [];
        } catch (error) {
            console.error('Erreur lors de la récupération:', error);
            return [];
        }
    };

    const showValidateButton = () => {
        document.getElementById('atlas-validate').style.display = 'block';
    };

    const hideValidateButton = () => {
        document.getElementById('atlas-validate').style.display = 'none';
    };

    // ***************************************************
    // ***************************************************
    // Helper Functions
    //
    const setColor = (c) => {
        let hex = c.replace(/[^A-Fa-f0-9]/g, "").toUpperCase();
        hex = hex.substring(0, 6);
        while (hex.length < 6) {
            hex += "0";
        }
        color[0] = parseInt(hex.substring(0, 2), 16);
        color[1] = parseInt(hex.substring(2, 4), 16);
        color[2] = parseInt(hex.substring(4, 6), 16);
        hex = "#" + hex;
        colorField.value = hex;
        colorSwatch.style.backgroundColor = hex;
    }

    const pickColor = (pos) => {
        color = glWindow.getColor(glWindow.click(pos));
        let hex = "#";
        for (let i = 0; i < color.length; i++) {
            let d = color[i].toString(16);
            if (d.length === 1) d = "0" + d;
            hex += d;
        }
        colorField.value = hex.toUpperCase();
        colorSwatch.style.backgroundColor = hex;
    }

    const drawPixel = (pos, color) => {
        pos = glWindow.click(pos);
        if (pos) {
            const oldColor = glWindow.getColor(pos);
            for (let i = 0; i < oldColor.length; i++) {
                if (oldColor[i] !== color[i]) {
                    place.setPixel(parseInt(pos.x), parseInt(pos.y), color);
                    break;
                }
            }
        }
    }

    const zoomIn = (v) => {
        let zoom = glWindow.getZoom();
        glWindow.setZoom(zoom * v);
        glWindow.draw();
        if (isSelecting) {
            updateAllSelectionOverlays();
        }
    }

    const zoomOut = (v) => {
        let zoom = glWindow.getZoom();
        if (zoom < 1) return;
        glWindow.setZoom(zoom / v);
        glWindow.draw();
        if (isSelecting) {
            updateAllSelectionOverlays();
        }
    }

    // Event listeners pour les boutons Atlas
    document.getElementById('atlas-button').addEventListener('click', function() {
        const dropdown = document.getElementById('atlas-dropdown');
        dropdown.classList.toggle('show');
    });

    document.getElementById('atlas-select').addEventListener('click', function() {
        startSelection();
    });

    document.getElementById('atlas-validate').addEventListener('click', function() {
        captureSelectedArea();
    });

    document.addEventListener('click', function(event) {
        const atlas = document.getElementById('atlas');
        const dropdown = document.getElementById('atlas-dropdown');
        
        if (!atlas.contains(event.target)) {
            dropdown.classList.remove('show');
        }
    });

    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', function() {
            console.log('Cliqué sur:', this.textContent);
            document.getElementById('atlas-dropdown').classList.remove('show');
        });
    });

    // Exposer les fonctions de sélection pour les tests
    window.placeSelections = {
        getAll: getAllSelections,
        cancel: cancelSelection
    };

    setColor("#000000");
}