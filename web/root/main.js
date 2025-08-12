function main() {
    let cvs = document.querySelector("#viewport-canvas");
    let glWindow = new GLWindow(cvs);

    if (!glWindow.ok()) return;

    let place = new Place(glWindow);
    place.initConnection();
    GUI(cvs, glWindow, place);
}

const preventCanvasInteraction = (element) => {
    // Seuls les événements qui interfèrent avec le canvas doivent être stoppés
    element.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });
    element.addEventListener('mousemove', (e) => {
        e.stopPropagation();
    });
    element.addEventListener('mouseup', (e) => {
        e.stopPropagation();
    });
    // Ne pas bloquer wheel pour permettre le scroll dans le dropdown
    element.addEventListener('touchstart', (e) => {
        e.stopPropagation();
    });
    element.addEventListener('touchmove', (e) => {
        e.stopPropagation();
    });
    element.addEventListener('touchend', (e) => {
        e.stopPropagation();
    });
};

const GUI = (cvs, glWindow, place) => {
    let color = new Uint8Array([0, 0, 0]);
    let dragdown = false;
    let lastMovePos = {x: 0, y: 0};
    let touchstartTime;
    
    let isSelecting = false;
    let selectedPixels = new Set();
    let selectionOverlays = [];
    let isSelectionDragging = false;
    let currentSelectionData = null;

    const colorField = document.querySelector("#color-field");
    const colorPreset = document.querySelector("#color-preset");
    const colorSwatch = document.querySelector("#color-swatch");

    const modal = document.getElementById('selection-modal');
    const modalName = document.getElementById('selection-name');
    const modalDescription = document.getElementById('selection-description');
    const modalCancel = document.getElementById('modal-cancel');
    const modalSave = document.getElementById('modal-save');

    const hasModal = modal && modalName && modalDescription && modalCancel && modalSave;

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
            selectPixelAtPosition(movePos);
        } else {
            glWindow.move(movePos.x - lastMovePos.x, movePos.y - lastMovePos.y);
            glWindow.draw();
            
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
        const canvasPos = glWindow.click(screenPos);
        
        if (!canvasPos) return;

        const x = Math.floor(canvasPos.x);
        const y = Math.floor(canvasPos.y);
        const pixelKey = `${x},${y}`;

        if (!selectedPixels.has(pixelKey)) {
            selectedPixels.add(pixelKey);
            drawTemporaryPixelBorder(x, y);
            console.log(`Pixel sélectionné: (${x}, ${y})`);
        }
    };

    const drawTemporaryPixelBorder = (x, y) => {
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
        
        updatePixelOverlaySimple(overlay, x, y);
    };

    const updatePixelOverlaySimple = (overlay, x, y) => {
        const testScreenPos = {x: cvs.offsetLeft + cvs.width/2, y: cvs.offsetTop + cvs.height/2};
        const testCanvasPos = glWindow.click(testScreenPos);
        
        if (!testCanvasPos) {
            overlay.style.display = 'none';
            return;
        }
        
        const centerX = testCanvasPos.x;
        const centerY = testCanvasPos.y;
        
        const zoom = glWindow.getZoom();
        const pixelSize = Math.max(2, zoom);
        
        const relativeX = (x - centerX) * zoom;
        const relativeY = (y - centerY) * zoom;
        
        const screenX = cvs.offsetLeft + cvs.width/2 + relativeX;
        const screenY = cvs.offsetTop + cvs.height/2 + relativeY;
        
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

        currentSelectionData = {
            timestamp: new Date().toISOString(),
            bounds: { minX, maxX, minY, maxY },
            pixels: pixelData
        };

        if (hasModal) {
            showNamingModal();
        } else {
            const name = prompt("Nom de la sélection:", "Ma sélection");
            const description = prompt("Description (optionnelle):", "");
            
            if (name) {
                saveDirectSelection(name.trim(), description ? description.trim() : "");
            } else {
                cancelSelection();
            }
        }
    };

    const saveDirectSelection = async (name, description) => {
        const selectionData = {
            ...currentSelectionData,
            name: name,
            description: description
        };

        try {
            const response = await fetch('/selections', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(selectionData)
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log(`Sélection "${name}" sauvegardée avec l'ID: ${result.id}`);
                await loadSelections();
                cancelSelection();
                console.log(`Zone "${name}" sauvegardée: ${selectionData.pixels.length} pixels`);
            } else {
                console.error('Erreur lors de la sauvegarde:', response.statusText);
                alert('Erreur lors de la sauvegarde');
            }
        } catch (error) {
            console.error('Erreur réseau:', error);
            alert('Erreur réseau lors de la sauvegarde');
        }
    };

    const showNamingModal = () => {
        if (!hasModal) return;
        modalName.value = '';
        modalDescription.value = '';
        modal.style.display = 'flex';
        modalName.focus();
    };

    const hideNamingModal = () => {
        if (!hasModal) return;
        modal.style.display = 'none';
        currentSelectionData = null;
    };

    const saveNamedSelection = async () => {
        if (!hasModal) return;
        
        const name = modalName.value.trim();
        if (!name) {
            alert('Veuillez saisir un nom pour la sélection');
            return;
        }

        await saveDirectSelection(name, modalDescription.value.trim());
        hideNamingModal();
    };

    const loadSelections = async () => {
        try {
            const response = await fetch('/selections');
            if (response.ok) {
                const selections = await response.json();
                updateDropdown(selections);
                return selections;
            }
            return [];
        } catch (error) {
            console.error('Erreur lors de la récupération:', error);
            return [];
        }
    };

    const loadSelection = (selection) => {
        removeAllSelectionOverlays();
        selectedPixels.clear();
        
        selection.pixels.forEach(pixel => {
            const pixelKey = `${pixel.x},${pixel.y}`;
            selectedPixels.add(pixelKey);
            drawTemporaryPixelBorder(pixel.x, pixel.y);
        });
        
        console.log(`Sélection "${selection.name}" visualisée: ${selection.pixels.length} pixels`);
    };

    const deleteSelection = async (id) => {
        if (!confirm('Êtes-vous sûr de vouloir supprimer cette sélection ?')) {
            return;
        }

        console.log(`Tentative de suppression de la sélection: ${id}`);

        try {
            const response = await fetch(`/selections?id=${id}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            console.log(`Réponse du serveur: ${response.status} ${response.statusText}`);
            
            if (response.ok) {
                const result = await response.json();
                console.log(`Sélection supprimée avec succès:`, result);
                
                await loadSelections();
            } else {
                const errorText = await response.text();
                console.error('Erreur lors de la suppression:', response.status, errorText);
                alert(`Erreur lors de la suppression: ${response.status} - ${errorText}`);
            }
        } catch (error) {
            console.error('Erreur réseau lors de la suppression:', error);
            alert('Erreur réseau lors de la suppression');
        }
    };

    // Ajouter quelques logs dans updateDropdown pour débugger
    const updateDropdown = (selections) => {
        const dropdown = document.getElementById('atlas-dropdown');
        if (!dropdown) {
            console.error('Dropdown atlas-dropdown non trouvé');
            return;
        }
        
        console.log(`Mise à jour du dropdown avec ${selections.length} sélections`);
        
        dropdown.innerHTML = '';
        
        // Empêcher les interactions avec le canvas sur le dropdown, SAUF wheel
        preventCanvasInteraction(dropdown);
        
        // Gérer spécifiquement le wheel pour permettre le scroll dans le dropdown
        dropdown.addEventListener('wheel', (e) => {
            // Ne pas propager SEULEMENT si on peut scroller dans le dropdown
            const canScrollUp = dropdown.scrollTop > 0;
            const canScrollDown = dropdown.scrollTop < (dropdown.scrollHeight - dropdown.clientHeight);
            
            if ((e.deltaY < 0 && canScrollUp) || (e.deltaY > 0 && canScrollDown)) {
                e.stopPropagation();
            }
        }, true);

        if (selections.length === 0) {
            const emptyItem = document.createElement('div');
            emptyItem.className = 'dropdown-item';
            emptyItem.innerHTML = '<span style="color: #888;">Aucune sélection</span>';
            dropdown.appendChild(emptyItem);
            return;
        }

        selections.forEach(selection => {
            console.log(`Ajout de la sélection: ${selection.name} (ID: ${selection.id})`);
            
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            
            // Empêcher les interactions canvas sur chaque item
            preventCanvasInteraction(item);
            
            const info = document.createElement('div');
            info.className = 'dropdown-item-info';
            
            const name = document.createElement('div');
            name.className = 'dropdown-item-name';
            name.textContent = selection.name;
            
            const description = document.createElement('div');
            description.className = 'dropdown-item-description';
            description.textContent = selection.description || `${selection.pixels.length} pixels`;
            
            info.appendChild(name);
            info.appendChild(description);
            
            const actions = document.createElement('div');
            actions.className = 'dropdown-item-actions';
            
            // Bouton œil pour visualiser la sélection
            const viewBtn = document.createElement('button');
            viewBtn.className = 'dropdown-action-btn';
            viewBtn.textContent = '👁';
            viewBtn.title = 'Visualiser la sélection';
            viewBtn.onclick = (e) => {
                e.stopPropagation();
                loadSelection(selection);
                dropdown.classList.remove('show');
            };
            
            // Bouton supprimer avec plus de logs
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'dropdown-action-btn delete-btn';
            deleteBtn.textContent = '×';
            deleteBtn.title = 'Supprimer la sélection';
            deleteBtn.onclick = async (e) => {
                console.log(`Clic sur supprimer pour la sélection: ${selection.id}`);
                e.stopPropagation();
                await deleteSelection(selection.id);
            };
            
            // Empêcher les interactions canvas sur les boutons
            preventCanvasInteraction(viewBtn);
            preventCanvasInteraction(deleteBtn);
            
            actions.appendChild(viewBtn);
            actions.appendChild(deleteBtn);
            
            item.appendChild(info);
            item.appendChild(actions);
            dropdown.appendChild(item);
        });
    };

    if (hasModal) {
        modalCancel.addEventListener('click', () => {
            hideNamingModal();
            cancelSelection();
        });

        modalSave.addEventListener('click', saveNamedSelection);

        modalName.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                if (modalDescription.value.trim() === '') {
                    modalDescription.focus();
                } else {
                    saveNamedSelection();
                }
            }
        });

        modalDescription.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                saveNamedSelection();
            }
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideNamingModal();
                cancelSelection();
            }
        });
    }

    const showValidateButton = () => {
        const validateBtn = document.getElementById('atlas-validate');
        if (validateBtn) validateBtn.style.display = 'block';
    };

    const hideValidateButton = () => {
        const validateBtn = document.getElementById('atlas-validate');
        if (validateBtn) validateBtn.style.display = 'none';
    };

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

    const atlasButton = document.getElementById('atlas-button');
    const atlasSelect = document.getElementById('atlas-select');
    const atlasValidate = document.getElementById('atlas-validate');

    if (atlasButton) {
        atlasButton.addEventListener('click', function() {
            const dropdown = document.getElementById('atlas-dropdown');
            dropdown.classList.toggle('show');
            
            // Charger les sélections quand on ouvre le dropdown
            if (dropdown.classList.contains('show')) {
                loadSelections();
            }
        });
    }

    if (atlasSelect) {
        atlasSelect.addEventListener('click', function() {
            startSelection();
        });
    }

    if (atlasValidate) {
        atlasValidate.addEventListener('click', function() {
            captureSelectedArea();
        });
    }

    document.addEventListener('click', function(event) {
        const atlas = document.getElementById('atlas');
        const dropdown = document.getElementById('atlas-dropdown');
        
        if (atlas && dropdown) {
            // Si on clique dans le dropdown, ne pas le fermer
            if (dropdown.contains(event.target)) {
                return;
            }
            
            // Si on clique en dehors de l'atlas, fermer le dropdown
            if (!atlas.contains(event.target)) {
                dropdown.classList.remove('show');
            }
        }
    });

    setTimeout(() => {
        loadSelections();
    }, 100);

    window.placeSelections = {
        getAll: loadSelections,
        cancel: cancelSelection
    };

    setColor("#000000");
}