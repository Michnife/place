package place

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gorilla/websocket"
	log "github.com/sirupsen/logrus"
	"image/color"
	"image/draw"
	"image/png"
	"net/http"
	"os"
	"path"
	"strconv"
	"sync"
	"time"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  64,
	WriteBufferSize: 64,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
	Error: func(w http.ResponseWriter, r *http.Request, status int, err error) {
		log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Get").Error(err)
		http.Error(w, "Error while trying to make websocket connection.", status)
	},
}

type PixelColor struct {
	X     int         `json:"x"`
	Y     int         `json:"y"`
	Color color.NRGBA `json:"color"`
}

type Server struct {
	sync.RWMutex
	msgs    chan PixelColor
	close   chan int
	clients []chan PixelColor
	img     draw.Image
	imgBuf  []byte
}

type Selection struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Timestamp   string    `json:"timestamp"`
	Bounds      Bounds    `json:"bounds"`
	Pixels      []Pixel   `json:"pixels"`
}

type Bounds struct {
	MinX int `json:"minX"`
	MaxX int `json:"maxX"`
	MinY int `json:"minY"`
	MaxY int `json:"maxY"`
}

type Pixel struct {
	X     int        `json:"x"`
	Y     int        `json:"y"`
	Color PixelRGBA  `json:"color"`
}

type PixelRGBA struct {
	R uint8 `json:"R"`
	G uint8 `json:"G"`
	B uint8 `json:"B"`
	A uint8 `json:"A"`
}

func NewServer(img draw.Image, count int) *Server {
	sv := &Server{
		RWMutex: sync.RWMutex{},
		msgs:    make(chan PixelColor),
		close:   make(chan int),
		clients: make([]chan PixelColor, count),
		img:     img,
	}
	go sv.broadcastLoop()
	return sv
}

func (sv *Server) ServeHTTP(w http.ResponseWriter, req *http.Request) {
    log.WithField("path", req.URL.Path).WithField("method", req.Method).Debug("Request received")
    
    switch {
    case path.Base(req.URL.Path) == "selections":
        sv.handleSelections(w, req)
    case path.Base(req.URL.Path) == "place.png":
        sv.HandleGetImage(w, req)
    case path.Base(req.URL.Path) == "stat":
        sv.HandleGetStat(w, req)
    case path.Base(req.URL.Path) == "ws":
        sv.HandleSocket(w, req)
    default:
        log.WithField("path", req.URL.Path).Warning("Route not found")
        http.NotFound(w, req)
    }
}

func (sv *Server) HandleGetImage(w http.ResponseWriter, r *http.Request) {
	log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Image").Trace("Image requested")
	b := sv.GetImageBytes()
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Length", strconv.Itoa(len(b)))
	w.Header().Set("Cache-Control", "no-cache, no-store")
	_, err := w.Write(b)
	if err != nil {
		log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Image").Error(err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (sv *Server) HandleGetStat(w http.ResponseWriter, r *http.Request) {
	log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Stat").Trace("Stats requested")
	count := 0
	total := 0
	for _, ch := range sv.clients {
		if ch != nil {
			count++
		}
		total++
	}

	w.Header().Set("Content-Type", "application/json")
	err := json.NewEncoder(w).Encode(map[string]interface{}{
		"connections": count,
		"slots":       total,
	})
	if err != nil {
		log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Stat").Error(err)
		http.Error(w, err.Error(), 500)
	}
}

func (sv *Server) HandleSocket(w http.ResponseWriter, r *http.Request) {
	log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Get").Trace("WebSocket requested")
	sv.Lock()
	defer sv.Unlock()
	i := sv.getConnIndex()
	if i == -1 {
		log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Get").Warning("Server full")
		http.Error(w, "Server full", 509)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Get").Error(err)
		return
	}
	log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Get").Info("Connected")
	ch := make(chan PixelColor)
	sv.clients[i] = ch
	go sv.readLoop(conn, r, i)
	go sv.writeLoop(conn, r, i)
}

func (sv *Server) getConnIndex() int {
	for i, client := range sv.clients {
		if client == nil {
			return i
		}
	}
	return -1
}

func (sv *Server) readLoop(conn *websocket.Conn, r *http.Request, i int) {
	for {
		log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Read").Trace("Waiting for message from ", i)
		var p PixelColor
		_, msg, err := conn.ReadMessage()
		if err == nil {
			if bytes.Equal(msg, []byte("ping")) {
				log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Read").Debug("Received ping message")
				err = conn.WriteMessage(websocket.TextMessage, []byte("pong"))
			} else {
				err = json.Unmarshal(msg, &p)
			}
		}

		if err != nil {
			if _, nok := err.(*websocket.CloseError); nok {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Read").Error("Unexpected close error, ", err)
				} else {
					log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Read").Info("Close request received, ", err)
				}
			} else {
				log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Read").Error("Error decoding message (", msg, "), ", err)
			}
			break
		}

		if p == (PixelColor{}) {
			continue
		}

		err = sv.handleMessage(p)
		if err == nil {
			log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Read").Debug("Pixel (" + strconv.Itoa(p.X) + ", " + strconv.Itoa(p.Y) + ") changed to " + toHex(p.Color))
		} else {
			log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Read").Error("Client kicked for bad message", err)
			break
		}
	}
	sv.close <- i
	log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Read").Info("Disconnected")
}

func toHex(c color.NRGBA) string {
	return fmt.Sprintf("#%02x%02x%02x%02x", c.R, c.G, c.B, c.A)
}

func (sv *Server) writeLoop(conn *websocket.Conn, r *http.Request, i int) {
	for {
		if sv.clients[i] == nil {
			log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Write").Warning("Write connection aborted")
			break
		}
		log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Write").Trace("Waiting for message to send to ", i)
		if p, ok := <-sv.clients[i]; ok {
			err := conn.WriteJSON(p)
			if err == nil {
				log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Write").Debug("Propagated pixel change at " + strconv.Itoa(p.X) + ", " + strconv.Itoa(p.Y))
			} else {
				log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Write").Error("Write error ", err)
				break
			}
		}
	}

	log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Write").Warning("Exited")
	err := conn.Close()
	if err != nil {
		log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Socket").WithField("action", "Write").Error("Error closing write connection ", err)
		return
	}
}

func (sv *Server) handleMessage(response PixelColor) error {
	if !sv.setPixel(response.X, response.Y, response.Color) {
		return errors.New("invalid placement")
	}
	sv.msgs <- response
	return nil
}

func (sv *Server) broadcastLoop() {
	for {
		select {
		case i := <-sv.close:
			if sv.clients[i] != nil {
				close(sv.clients[i])
				sv.clients[i] = nil
			}
		case p := <-sv.msgs:
			for _, ch := range sv.clients {
				if ch != nil {
					ch <- p
				}
			}
		}
	}
}

func (sv *Server) GetImageBytes() []byte {
	if sv.imgBuf == nil {
		buf := bytes.NewBuffer(nil)
		if err := png.Encode(buf, sv.img); err != nil {
			log.Error(err)
		}
		sv.imgBuf = buf.Bytes()
	}
	return sv.imgBuf
}

func (sv *Server) setPixel(x, y int, c color.Color) bool {
	rect := sv.img.Bounds()
	width := rect.Max.X - rect.Min.X
	height := rect.Max.Y - rect.Min.Y
	if 0 > x || x >= width || 0 > y || y >= height {
		return false
	}
	sv.img.Set(x, y, c)
	sv.imgBuf = nil
	return true
}

func (sv *Server) handleSelections(w http.ResponseWriter, r *http.Request) {
    log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Selections").WithField("path", r.URL.Path).WithField("method", r.Method).Debug("Selection API requested")
    
    w.Header().Set("Content-Type", "application/json")
    w.Header().Set("Access-Control-Allow-Origin", "*")
    w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
    w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

    // Récupérer l'ID depuis les paramètres de requête (comme stat le fait)
    id := r.URL.Query().Get("id")
    action := r.URL.Query().Get("action")
    
    switch r.Method {
    case "GET":
        if id != "" {
            sv.getSelection(w, r, id)
        } else {
            sv.getAllSelections(w, r)
        }
    case "POST":
        sv.saveSelection(w, r)
    case "DELETE":
        if action == "clear" {
            sv.clearAllSelections(w, r)
        } else if id != "" {
            sv.deleteSelectionById(w, r, id)
        } else {
            http.Error(w, "ID requis pour la suppression", http.StatusBadRequest)
        }
    case "OPTIONS":
        w.WriteHeader(http.StatusOK)
    default:
        http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
    }
}

func (sv *Server) saveSelection(w http.ResponseWriter, r *http.Request) {
    var selection Selection
    if err := json.NewDecoder(r.Body).Decode(&selection); err != nil {
        log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Selections").Error("Invalid JSON:", err)
        http.Error(w, "Invalid JSON", http.StatusBadRequest)
        return
    }

    selection.ID = "selection_" + strconv.FormatInt(time.Now().UnixNano(), 10)

    // Utiliser un système de stockage similaire aux pixels
    selections := sv.loadSelections()
    selections = append(selections, selection)

    if err := sv.saveSelections(selections); err != nil {
        log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Selections").Error("Erreur lors de la sauvegarde:", err)
        http.Error(w, "Erreur lors de la sauvegarde", http.StatusInternalServerError)
        return
    }

    log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Selections").WithField("id", selection.ID).Info("Sélection sauvegardée")
    json.NewEncoder(w).Encode(map[string]string{"id": selection.ID})
}

func (sv *Server) getAllSelections(w http.ResponseWriter, r *http.Request) {
    selections := sv.loadSelections()
    log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Selections").Debug("Returning", len(selections), "selections")
    json.NewEncoder(w).Encode(selections)
}

func (sv *Server) getSelection(w http.ResponseWriter, r *http.Request, id string) {
    selections := sv.loadSelections()

    for _, selection := range selections {
        if selection.ID == id {
            log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Selections").Debug("Returning selection", id)
            json.NewEncoder(w).Encode(selection)
            return
        }
    }

    log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Selections").Warning("Selection not found:", id)
    http.Error(w, "Sélection non trouvée", http.StatusNotFound)
}

func (sv *Server) deleteSelectionById(w http.ResponseWriter, r *http.Request, id string) {
    if id == "" {
        log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Selections").Warning("ID de sélection vide")
        http.Error(w, "ID de sélection requis", http.StatusBadRequest)
        return
    }
    
    selections := sv.loadSelections()
    log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Selections").Debug("Tentative de suppression de:", id)
    log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Selections").Debug("Nombre de sélections:", len(selections))

    for i, selection := range selections {
        if selection.ID == id {
            selections = append(selections[:i], selections[i+1:]...)
            if err := sv.saveSelections(selections); err != nil {
                log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Selections").Error("Erreur lors de la suppression:", err)
                http.Error(w, "Erreur lors de la suppression", http.StatusInternalServerError)
                return
            }
            log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Selections").WithField("id", id).Info("Sélection supprimée")
            
            response := map[string]string{"message": "Sélection supprimée", "id": id}
            w.Header().Set("Content-Type", "application/json")
            json.NewEncoder(w).Encode(response)
            return
        }
    }

    log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Selections").Warning("Selection not found for deletion:", id)
    http.Error(w, "Sélection non trouvée", http.StatusNotFound)
}

func (sv *Server) clearAllSelections(w http.ResponseWriter, r *http.Request) {
    if err := sv.saveSelections([]Selection{}); err != nil {
        log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Selections").Error("Erreur lors de la suppression:", err)
        http.Error(w, "Erreur lors de la suppression", http.StatusInternalServerError)
        return
    }

    log.WithField("ip", r.RemoteAddr).WithField("endpoint", "Selections").Info("Toutes les sélections ont été supprimées")
    w.WriteHeader(http.StatusOK)
}

// Système de stockage inspiré du stockage des pixels
func (sv *Server) loadSelections() []Selection {
    data, err := os.ReadFile("selections.json")
    if err != nil {
        if os.IsNotExist(err) {
            log.Debug("Fichier selections.json n'existe pas, création d'une liste vide")
            return []Selection{}
        }
        log.Error("Erreur lors de la lecture du fichier selections.json:", err)
        return []Selection{}
    }

    var selections []Selection
    if err := json.Unmarshal(data, &selections); err != nil {
        log.Error("Erreur lors du parsing JSON du fichier selections.json:", err)
        return []Selection{}
    }

    return selections
}

func (sv *Server) saveSelections(selections []Selection) error {
    data, err := json.MarshalIndent(selections, "", "  ")
    if err != nil {
        return fmt.Errorf("erreur lors de la sérialisation JSON: %v", err)
    }

    if err := os.WriteFile("selections.json", data, 0644); err != nil {
        return fmt.Errorf("erreur lors de l'écriture du fichier: %v", err)
    }

    log.Debug("Fichier selections.json sauvegardé avec", len(selections), "sélections")
    return nil
}
