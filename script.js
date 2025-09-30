// =====================
// SAVATE OFFICIALS - Interface CPTE Complète
// Application Professionnelle avec WebRTC P2P
// =====================

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('/sw.js')
        .then(function(registration) {
            console.log('✅ Service Worker enregistré:', registration.scope);
            
            // Vérifier les mises à jour
            registration.addEventListener('updatefound', function() {
                const newWorker = registration.installing;
                newWorker.addEventListener('statechange', function() {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        // Nouvelle version disponible
                        if (confirm('Une nouvelle version est disponible. Voulez-vous recharger ?')) {
                            window.location.reload();
                        }
                    }
                });
            });
        })
        .catch(function(error) {
            console.log('❌ Échec enregistrement Service Worker:', error);
        });
    });
}

// PWA Install Prompt
let deferredPrompt;
const installPrompt = document.getElementById('pwaInstallPrompt');

window.addEventListener('beforeinstallprompt', function(e) {
    console.log('💡 PWA installable détectée');
    e.preventDefault();
    deferredPrompt = e;
    
    // Afficher le bouton d'installation si pas déjà installé
    if (!window.matchMedia('(display-mode: standalone)').matches) {
        if (installPrompt) installPrompt.style.display = 'block';
    }
});

if (installPrompt) {
    installPrompt.addEventListener('click', function() {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(function(choiceResult) {
                if (choiceResult.outcome === 'accepted') {
                    console.log('✅ PWA installée');
                } else {
                    console.log('❌ Installation PWA refusée');
                }
                deferredPrompt = null;
                installPrompt.style.display = 'none';
            });
        }
    });
}

// Cacher le prompt si déjà installé
window.addEventListener('appinstalled', function() {
    console.log('✅ PWA installée avec succès');
    if (installPrompt) installPrompt.style.display = 'none';
});

// =====================
// VARIABLES GLOBALES ET CONFIGURATION
// =====================

const app = {
    session: {
        id: '',
        code: '',
        role: '', // 'delegate' ou 'judge'
        fightType: '',
        judgeCount: 3,
        rounds: 3,
        initialized: false,
        startTime: null,
        status: 'waiting', // 'waiting', 'active', 'completed'
        judgeName: '',
        judgeNumber: '',
        judgeId: null
    },
    
    webrtc: {
        peer: null,
        connections: new Map(),
        isInitialized: false
    },
    
    data: {
        fighters: {
            red: '',
            blue: ''
        },
        judges: {},
        connectedDevices: new Set(),
        lastSync: null
    },
    
    ui: {
        currentTab: 'monitoring',
        notifications: [],
        isUpdating: false
    },
    
    history: {
        delegate: [],
        judge: []
    }
};

// =====================
// UTILITAIRES GÉNÉRAUX
// =====================

function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateUniqueCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function formatTime(timestamp) {
    if (!timestamp) return 'Jamais';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('fr-FR', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
}

function getFightTypeLabel(type) {
    const labels = {
        'assaut': 'Assaut (3 reprises)',
        'combat2espoirs': 'Combat 2ème Série Espoirs (3 reprises)',
        'combat1espoirs': 'Combat 1ère Série Espoirs (5 reprises)',
        'combat2seniors': 'Combat 2ème Série Seniors (3 reprises)',
        'combat1seniors': 'Combat 1ère Série Seniors (5 reprises)'
    };
    return labels[type] || type;
}

function getRoundsFromFightType(type) {
    return (type === 'combat1espoirs' || type === 'combat1seniors') ? 5 : 3;
}

function isCombat() {
    return app.session.fightType && app.session.fightType.includes('combat');
}

function showNotification(message, type = 'info', duration = 5000) {
    console.log(`📢 ${type.toUpperCase()}: ${message}`);
    
    // Créer l'élément de notification
    const notification = document.createElement('div');
    notification.className = `message ${type}`;
    notification.style.position = 'fixed';
    notification.style.top = '20px';
    notification.style.left = '50%';
    notification.style.transform = 'translateX(-50%)';
    notification.style.zIndex = '9999';
    notification.style.maxWidth = '500px';
    notification.style.animation = 'slideDown 0.3s ease-out';
    notification.innerHTML = message;
    
    document.body.appendChild(notification);
    
    // Supprimer après la durée spécifiée
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'fadeOut 0.3s ease-out';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }
    }, duration);
}

// =====================
// WEBRTC ET COMMUNICATION
// =====================

async function initializeWebRTC() {
    return new Promise((resolve, reject) => {
        try {
            if (app.webrtc.isInitialized) {
                console.log('⚠️ WebRTC déjà initialisé');
                resolve();
                return;
            }
            
            const peerId = app.session.role === 'delegate' 
                ? `delegate_${app.session.code}`
                : `judge_${app.session.judgeId}_${app.session.code}`;
            
            console.log(`🔧 Initialisation WebRTC: ${peerId}`);
            
            app.webrtc.peer = new Peer(peerId, {
                host: 'peerjs-server.herokuapp.com',
                port: 443,
                secure: true,
                debug: 2
            });
            
            app.webrtc.peer.on('open', (id) => {
                console.log(`✅ WebRTC ouvert: ${id}`);
                app.webrtc.isInitialized = true;
                updateSyncIndicator();
                resolve();
            });
            
            app.webrtc.peer.on('connection', (conn) => {
                console.log(`📞 Connexion entrante: ${conn.peer}`);
                setupConnection(conn);
            });
            
            app.webrtc.peer.on('error', (error) => {
                console.error('❌ Erreur WebRTC:', error);
                reject(error);
            });
            
            app.webrtc.peer.on('disconnected', () => {
                console.log('🔌 WebRTC déconnecté');
                updateSyncIndicator();
            });
            
        } catch (error) {
            console.error('❌ Erreur initialisation WebRTC:', error);
            reject(error);
        }
    });
}

function connectToPeer(peerId) {
    return new Promise((resolve, reject) => {
        try {
            console.log(`🔗 Connexion à: ${peerId}`);
            
            const conn = app.webrtc.peer.connect(peerId);
            setupConnection(conn);
            
            conn.on('open', () => {
                console.log(`✅ Connexion établie: ${peerId}`);
                
                // Envoyer les infos du juge
                if (app.session.role === 'judge') {
                    sendMessage(conn, {
                        type: 'judge_info',
                        data: {
                            id: app.session.judgeId,
                            name: app.session.judgeName,
                            number: app.session.judgeNumber,
                            connected: true,
                            lastUpdate: Date.now()
                        }
                    });
                }
                
                resolve();
            });
            
            conn.on('error', (error) => {
                console.error(`❌ Erreur connexion ${peerId}:`, error);
                reject(error);
            });
            
        } catch (error) {
            console.error('❌ Erreur connectToPeer:', error);
            reject(error);
        }
    });
}

function setupConnection(conn) {
    app.webrtc.connections.set(conn.peer, conn);
    
    conn.on('data', (data) => {
        handleIncomingMessage(data, conn);
    });
    
    conn.on('close', () => {
        console.log(`🔌 Connexion fermée: ${conn.peer}`);
        app.webrtc.connections.delete(conn.peer);
        cleanupJudgeData(conn.peer);
        updatePeersList();
    });
    
    conn.on('error', (error) => {
        console.error(`❌ Erreur connexion ${conn.peer}:`, error);
        app.webrtc.connections.delete(conn.peer);
        cleanupJudgeData(conn.peer);
        updatePeersList();
    });
    
    updatePeersList();
}

function sendMessage(conn, message) {
    if (conn && conn.open) {
        try {
            conn.send(message);
            console.log(`📤 Message envoyé à ${conn.peer}:`, message.type);
        } catch (error) {
            console.error(`❌ Erreur envoi à ${conn.peer}:`, error);
        }
    }
}

function sendToAll(message, priority = 'normal') {
    const timestamp = Date.now();
    const fullMessage = {
        ...message,
        timestamp,
        priority,
        sessionId: app.session.id
    };
    
    let sentCount = 0;
    app.webrtc.connections.forEach((conn, peerId) => {
        if (conn.open) {
            sendMessage(conn, fullMessage);
            sentCount++;
        }
    });
    
    console.log(`📡 Message diffusé à ${sentCount} pairs:`, message.type);
    app.data.lastSync = timestamp;
    updateSyncIndicator();
}

function handleIncomingMessage(data, conn) {
    console.log(`📥 Message reçu de ${conn.peer}:`, data.type);
    
    try {
        switch (data.type) {
            case 'judge_info':
                handleJudgeInfo(data.data, conn.peer);
                break;
            case 'judge_data':
                handleJudgeData(data.data, conn.peer);
                break;
            case 'fighter_names':
                handleFighterNames(data.data);
                break;
            case 'session_config':
                handleSessionConfig(data.data);
                break;
            case 'sync_request':
                handleSyncRequest(conn);
                break;
            case 'reset_partial':
                handlePartialReset(data.data);
                break;
            case 'reset_complete':
                handleCompleteReset();
                break;
            default:
                console.log(`⚠️ Type de message inconnu: ${data.type}`);
        }
        
        updateSyncIndicator();
        
    } catch (error) {
        console.error('❌ Erreur traitement message:', error);
    }
}

function handleJudgeInfo(judgeData, peerId) {
    const judgeKey = `judge_${judgeData.id}`;
    
    if (!app.data.judges[judgeKey]) {
        app.data.judges[judgeKey] = {};
    }
    
    app.data.judges[judgeKey] = {
        ...app.data.judges[judgeKey],
        ...judgeData,
        peerId: peerId,
        connected: true,
        lastUpdate: Date.now()
    };
    
    console.log(`👨‍⚖️ Juge connecté: ${judgeData.name} (${judgeData.id})`);
    
    if (app.session.role === 'delegate') {
        // Envoyer la config de session au nouveau juge
        const conn = app.webrtc.connections.get(peerId);
        if (conn) {
            sendMessage(conn, {
                type: 'session_config',
                data: {
                    fightType: app.session.fightType,
                    rounds: app.session.rounds,
                    fighters: app.data.fighters
                }
            });
        }
        
        updateJudgeMonitoring();
        showNotification(`👨‍⚖️ Juge ${judgeData.name} connecté`, 'success');
    }
}

function handleJudgeData(judgeData, peerId) {
    const judgeKey = Object.keys(app.data.judges).find(key => 
        app.data.judges[key].peerId === peerId
    );
    
    if (judgeKey) {
        app.data.judges[judgeKey] = {
            ...app.data.judges[judgeKey],
            ...judgeData,
            lastUpdate: Date.now()
        };
        
        if (app.session.role === 'delegate') {
            updateJudgeMonitoring();
            updateRecapTable();
            updateFinalResult();
        }
    }
}

function handleFighterNames(fighterData) {
    app.data.fighters = fighterData;
    
    if (app.session.role === 'judge') {
        document.getElementById('judgeRedFighter').value = fighterData.red || '';
        document.getElementById('judgeBlueFighter').value = fighterData.blue || '';
        updateCompletionIndicators();
    }
}

function handleSessionConfig(configData) {
    if (app.session.role === 'judge') {
        app.session.fightType = configData.fightType;
        app.session.rounds = configData.rounds;
        app.data.fighters = configData.fighters || { red: '', blue: '' };
        
        // Mettre à jour l'interface juge
        updateJudgeTypeSelection();
        createJudgeScoringTable();
        
        document.getElementById('judgeRedFighter').value = app.data.fighters.red || '';
        document.getElementById('judgeBlueFighter').value = app.data.fighters.blue || '';
        updateCompletionIndicators();
    }
}

function handleSyncRequest(conn) {
    if (app.session.role === 'delegate') {
        // Envoyer toutes les données actuelles
        sendMessage(conn, {
            type: 'full_sync',
            data: {
                session: app.session,
                fighters: app.data.fighters,
                judges: app.data.judges
            }
        });
    }
}

function updateSyncIndicator() {
    const syncIndicator = document.getElementById('syncIndicator');
    const syncIcon = document.getElementById('syncIcon');
    const syncStatus = document.getElementById('syncStatus');
    const devicesCount = document.getElementById('devicesCount');
    
    if (syncIndicator && syncIcon && syncStatus && devicesCount) {
        if (!app.webrtc.isInitialized) {
            syncIndicator.className = 'sync-indicator loading';
            syncIcon.textContent = '🔄';
            syncStatus.textContent = 'Initialisation...';
            devicesCount.textContent = '0 appareils';
        } else if (app.webrtc.connections.size === 0) {
            syncIndicator.className = 'sync-indicator offline';
            syncIcon.textContent = '📡';
            syncStatus.textContent = app.session.role === 'delegate' ? 'En attente de juges' : 'Recherche délégué';
            devicesCount.textContent = '0 appareils';
        } else {
            syncIndicator.className = 'sync-indicator connected';
            syncIcon.textContent = '✅';
            
            if (app.session.role === 'delegate') {
                const connectedJudges = Object.keys(app.data.judges).filter(k => app.data.judges[k].connected).length;
                syncStatus.textContent = `Délégué actif`;
                devicesCount.textContent = `${app.webrtc.connections.size} connexions • ${connectedJudges} juges`;
            } else {
                syncStatus.textContent = 'Juge connecté';
                const deviceCount = app.data.connectedDevices.size;
                const judgeCount = Object.keys(app.data.judges).filter(k => app.data.judges[k].connected).length;
                devicesCount.textContent = `${deviceCount} appareils • ${judgeCount} juges`;
            }
        }
    }
}

function updatePeersList() {
    app.data.connectedDevices.clear();
    app.webrtc.connections.forEach((conn, peerId) => {
        if (conn.open) {
            app.data.connectedDevices.add(peerId);
        }
    });
    updateSyncIndicator();
}

function cleanupJudgeData(peerId) {
    Object.keys(app.data.judges).forEach(judgeKey => {
        const judge = app.data.judges[judgeKey];
        if (judge.peerId === peerId) {
            judge.connected = false;
            judge.lastUpdate = Date.now();
        }
    });
    
    if (app.session.role === 'delegate') {
        updateJudgeMonitoring();
    }
}

// =====================
// GESTIONNAIRE DE SESSIONS
// =====================

function selectRole(role) {
    app.session.role = role;
    document.getElementById('roleSelector').classList.add('hidden');
    
    if (role === 'delegate') {
        document.getElementById('delegateInterface').classList.remove('hidden');
        showNotification('👑 Mode délégué activé', 'success');
    } else if (role === 'judge') {
        document.getElementById('judgeAccessSection').classList.remove('hidden');
        showNotification('⚖️ Mode juge activé', 'info');
    }
}

function goBack() {
    document.getElementById('judgeAccessSection').classList.add('hidden');
    document.getElementById('delegateInterface').classList.add('hidden');
    document.getElementById('judgeInterface').classList.add('hidden');
    document.getElementById('roleSelector').classList.remove('hidden');
    document.getElementById('contentArea').style.display = 'block';
    
    const syncIndicator = document.getElementById('syncIndicator');
    if (syncIndicator) syncIndicator.classList.add('hidden');
    
    app.session.role = '';
}

function createSession() {
    console.log('🚀 Création session...');
    
    const createButton = document.getElementById('createSessionButton');
    createButton.disabled = true;
    createButton.innerHTML = '<div class="loading-spinner"></div> Création...';
    
    app.session.fightType = document.querySelector('input[name="fightType"]:checked').value;
    app.session.judgeCount = parseInt(document.querySelector('input[name="judgeCount"]:checked').value);
    app.session.rounds = getRoundsFromFightType(app.session.fightType);
    
    app.session.id = generateSessionId();
    app.session.code = generateUniqueCode();
    app.session.initialized = true;
    app.session.role = 'delegate';
    app.session.startTime = Date.now();
    app.session.status = 'active';
    
    initializeWebRTC().then(() => {
        console.log('✅ WebRTC délégué initialisé');
        
        document.getElementById('configSection').classList.add('hidden');
        showDelegateInterface();
        
        showNotification('✅ Session WebRTC créée!', 'success');
        
        createButton.disabled = false;
        createButton.innerHTML = '🚀 Créer Session WebRTC';
        
    }).catch(error => {
        console.error('❌ Erreur WebRTC:', error);
        showNotification('❌ Erreur création: ' + error.message, 'error');
        
        createButton.disabled = false;
        createButton.innerHTML = '🚀 Créer Session WebRTC';
    });
}

function accessJudgeSheet() {
    const accessKey = document.getElementById('accessKeyInput').value.trim();
    const judgeName = document.getElementById('judgeNameInput').value.trim();
    const judgeNumber = document.getElementById('judgeNumberInput').value.trim();
    
    if (!accessKey || !judgeName || !judgeNumber) {
        showNotification('⚠️ Veuillez remplir tous les champs', 'error');
        return;
    }
    
    if (!/^\d{4}$/.test(accessKey)) {
        showNotification('❌ Code à 4 chiffres requis', 'error');
        return;
    }
    
    if (judgeName.length < 2) {
        showNotification('❌ Nom trop court', 'error');
        return;
    }
    
    const connectButton = document.getElementById('connectButton');
    connectButton.disabled = true;
    connectButton.innerHTML = '<div class="loading-spinner"></div> Connexion...';
    
    app.session.code = accessKey;
    app.session.judgeName = judgeName;
    app.session.judgeNumber = judgeNumber;
    app.session.judgeId = Math.floor(Math.random() * 1000) + 1;
    app.session.role = 'judge';
    
    initializeWebRTC().then(() => {
        const delegatePeerId = `delegate_${accessKey}`;
        return connectToPeer(delegatePeerId);
    }).then(() => {
        console.log('✅ Connexion juge établie');
        document.getElementById('judgeAccessSection').classList.add('hidden');
        showJudgeInterface();
        
        showNotification('✅ Connexion WebRTC établie!', 'success');
        
        connectButton.disabled = false;
        connectButton.innerHTML = '🚪 Se connecter WebRTC';
        
    }).catch(error => {
        console.error('❌ Erreur connexion:', error);
        showNotification('❌ Erreur: ' + error.message, 'error');
        
        connectButton.disabled = false;
        connectButton.innerHTML = '🚪 Se connecter WebRTC';
    });
}

console.log('✅ SAVATE OFFICIALS - Interface CPTE Complète Finalisée avec succès');

// =====================
// INTERFACE DÉLÉGUÉ
// =====================

function showDelegateInterface() {
    document.getElementById('delegateDashboard').classList.remove('hidden');
    document.getElementById('contentArea').style.display = 'none';
    document.getElementById('syncIndicator').classList.remove('hidden');
    
    // Afficher infos session
    document.getElementById('sessionCodeDisplay').textContent = app.session.code;
    document.getElementById('fightTypeDisplay').textContent = getFightTypeLabel(app.session.fightType);
    document.getElementById('judgeCountDisplay').textContent = app.session.judgeCount;
    document.getElementById('roundsDisplay').textContent = app.session.rounds;
    
    updateJudgeMonitoring();
    
    // Mise à jour périodique
    setInterval(() => {
        if (app.session.role === 'delegate' && app.session.initialized) {
            const activeTab = document.querySelector('.tab-panel.active');
            if (activeTab) {
                const tabId = activeTab.id;
                switch(tabId) {
                    case 'monitoringTab':
                        updateJudgeMonitoring();
                        break;
                    case 'recapTab':
                        updateRecapTable();
                        break;
                    case 'resultTab':
                        updateFinalResult();
                        break;
                }
            }
        }
    }, 3000);
}

function updateFighterNames() {
    const redName = document.getElementById('fighterRedName').value.trim();
    const blueName = document.getElementById('fighterBlueName').value.trim();
    
    // Sauvegarder l'état avant modification
    saveDelegateState('MODIFICATION NOMS TIREURS', {
        previousRed: app.data.fighters.red,
        previousBlue: app.data.fighters.blue,
        newRed: redName,
        newBlue: blueName
    });
    
    app.data.fighters.red = redName;
    app.data.fighters.blue = blueName;
    
    sendToAll({
        type: 'fighter_names',
        data: app.data.fighters
    }, 'normal');
    
    updateJudgeMonitoring();
    showNotification('📝 Noms mis à jour', 'info', 2000);
}

// =====================
// SYSTÈME D'ONGLETS DÉLÉGUÉ
// =====================

function showTab(tabName) {
    // Masquer tous les onglets
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    
    // Désactiver tous les boutons
    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active');
    });
    
    // Activer l'onglet sélectionné
    const targetTab = document.getElementById(tabName + 'Tab');
    if (targetTab) {
        targetTab.classList.add('active');
    }
    
    // Activer le bon bouton
    const buttons = document.querySelectorAll('.tab-button');
    const buttonIndex = ['monitoring', 'recap', 'result', 'export'].indexOf(tabName);
    if (buttonIndex !== -1 && buttons[buttonIndex]) {
        buttons[buttonIndex].classList.add('active');
    }
    
    // Mettre à jour le contenu
    setTimeout(() => {
        switch(tabName) {
            case 'monitoring':
                updateJudgeMonitoring();
                break;
            case 'recap':
                updateRecapTable();
                break;
            case 'result':
                updateFinalResult();
                break;
            case 'export':
                break;
        }
    }, 100);
}

function updateJudgeMonitoring() {
    const container = document.getElementById('judgeMonitoring');
    if (!container) return;
    
    container.innerHTML = '<h3>📊 Monitoring des Juges - Interface CPTE Temps Réel</h3>';
    
    const judgeCount = Object.keys(app.data.judges).length;
    if (judgeCount === 0) {
        container.innerHTML += `
            <div class="message info">
                <h4>🎯 En attente de connexion des juges...</h4>
                <p><strong>Code de session:</strong> ${app.session.code}</p>
                <p><strong>Type:</strong> ${getFightTypeLabel(app.session.fightType)}</p>
                <p>Les juges doivent utiliser ce code pour se connecter.</p>
            </div>
        `;
        return;
    }
    
    // Créer une fiche pour chaque juge
    Object.keys(app.data.judges).forEach(judgeKey => {
        const judge = app.data.judges[judgeKey];
        const judgeContainer = createJudgeMonitoringCard(judge);
        container.appendChild(judgeContainer);
    });
}

function createJudgeMonitoringCard(judge) {
    const container = document.createElement('div');
    container.className = `judge-sheet-container ${judge.connected ? 'connected' : ''}`;
    container.id = `judge-monitor-${judge.id}`;
    
    // Header avec statut
    const header = document.createElement('div');
    header.className = 'judge-sheet-header';
    header.innerHTML = `
        <div>
            <h3>👨‍⚖️ Juge ${judge.id} - ${judge.name || 'Nom non défini'}</h3>
            <p><strong>Numéro:</strong> ${judge.number || 'Non défini'}</p>
        </div>
        <div class="judge-sheet-status">
            <div class="status-indicator ${judge.connected ? 'connected' : ''}"></div>
            <span>${judge.connected ? 'Connecté' : 'Déconnecté'}</span>
            <span style="font-size: 11px; color: #7f8c8d; margin-left: 10px;">
                ${judge.lastUpdate ? formatTime(judge.lastUpdate) : 'Jamais'}
            </span>
        </div>
    `;
    
    // Table CPTE complète identique à celle des juges
    const table = createCompleteMonitoringTable(judge);
    
    container.appendChild(header);
    container.appendChild(table);
    
    return container;
}

function createCompleteMonitoringTable(judge) {
    const isCombatType = isCombat();
    const table = document.createElement('table');
    table.className = 'scoring-table';
    table.style.fontSize = '11px';
    table.style.tableLayout = 'fixed';
    
    // Créer l'en-tête
    let headerHTML = '';
    if (isCombatType) {
        headerHTML = `
            <thead>
                <tr>
                    <th rowspan="2" style="width: 120px;">NOTATION</th>
                    <th colspan="4" style="background-color: #ef5350; color: white;">COIN ROUGE</th>
                    <th colspan="4" style="background-color: #42a5f5; color: white;">COIN BLEU</th>
                </tr>
                <tr>
                    <th class="corner-red">Reprise</th>
                    <th class="corner-red">NOTE</th>
                    <th class="corner-red">AVT</th>
                    <th class="corner-red">CPTE</th>
                    <th class="corner-blue">Reprise</th>
                    <th class="corner-blue">NOTE</th>
                    <th class="corner-blue">AVT</th>
                    <th class="corner-blue">CPTE</th>
                </tr>
            </thead>
        `;
    } else {
        headerHTML = `
            <thead>
                <tr>
                    <th rowspan="2" style="width: 120px;">NOTATION</th>
                    <th colspan="3" style="background-color: #ef5350; color: white;">COIN ROUGE</th>
                    <th colspan="3" style="background-color: #42a5f5; color: white;">COIN BLEU</th>
                </tr>
                <tr>
                    <th class="corner-red">Reprise</th>
                    <th class="corner-red">NOTE</th>
                    <th class="corner-red">AVT</th>
                    <th class="corner-blue">Reprise</th>
                    <th class="corner-blue">NOTE</th>
                    <th class="corner-blue">AVT</th>
                </tr>
            </thead>
        `;
    }
    
    // Créer le corps du tableau
    const notationText = isCombatType ? 
        `Égalité: 2/2<br>Gagné: 3/2<br>Dominé: 3/1<br>Non décision: X/X<br>Avertissement: -1<br>Compte: -1<br>Bonus: +1` :
        `Égalité: 2/2<br>Gagné: 3/2<br>Dominé: 3/1<br>Non décision: X/X<br>Avertissement: -1<br>Bonus: +1`;
    
    let bodyHTML = '<tbody>';
    
    // Lignes de reprises
    for (let i = 1; i <= app.session.rounds; i++) {
        const rowspanAttr = i === 1 ? `rowspan="${app.session.rounds}"` : '';
        const notationCell = i === 1 ? `<td ${rowspanAttr} style="vertical-align: top;" class="notation-cell"><small>${notationText}</small></td>` : '';
        
        const redScore = judge.scores ? (judge.scores[`red${i}`] || '-') : '-';
        const blueScore = judge.scores ? (judge.scores[`blue${i}`] || '-') : '-';
        const redWarning = judge.warnings && judge.warnings.red && judge.warnings.red[i] ? 'A' : '';
        const blueWarning = judge.warnings && judge.warnings.blue && judge.warnings.blue[i] ? 'A' : '';
        
        if (isCombatType) {
            const redCompte = judge.comptes && judge.comptes.red && judge.comptes.red[i] ? 'C' : '';
            const blueCompte = judge.comptes && judge.comptes.blue && judge.comptes.blue[i] ? 'C' : '';
            
            bodyHTML += `
                <tr>
                    ${notationCell}
                    <td class="corner-red">${i}</td>
                    <td class="corner-red">${redScore}</td>
                    <td class="corner-red">${redWarning}</td>
                    <td class="corner-red">${redCompte}</td>
                    <td class="corner-blue">${i}</td>
                    <td class="corner-blue">${blueScore}</td>
                    <td class="corner-blue">${blueWarning}</td>
                    <td class="corner-blue">${blueCompte}</td>
                </tr>
            `;
        } else {
            bodyHTML += `
                <tr>
                    ${notationCell}
                    <td class="corner-red">${i}</td>
                    <td class="corner-red">${redScore}</td>
                    <td class="corner-red">${redWarning}</td>
                    <td class="corner-blue">${i}</td>
                    <td class="corner-blue">${blueScore}</td>
                    <td class="corner-blue">${blueWarning}</td>
                </tr>
            `;
        }
    }
    
    // Lignes de totaux
    const redTotal = judge.totals ? judge.totals.red : 0;
    const blueTotal = judge.totals ? judge.totals.blue : 0;
    const decision = judge.decision || '-';
    
    if (isCombatType) {
        bodyHTML += `
            <tr class="subtotal">
                <td style="text-align: left; padding-left: 10px;">Sous TOTAUX 1</td>
                <td colspan="3" class="corner-red" style="text-align: center;">${judge.subtotals ? judge.subtotals.red1 : 0}</td>
                <td colspan="3" class="corner-blue" style="text-align: center;">${judge.subtotals ? judge.subtotals.blue1 : 0}</td>
            </tr>
            <tr class="subtotal">
                <td style="text-align: left; padding-left: 10px;">**Avertissements**</td>
                <td colspan="3" class="corner-red" style="text-align: center;">${judge.warningCounts ? judge.warningCounts.red : 0}</td>
                <td colspan="3" class="corner-blue" style="text-align: center;">${judge.warningCounts ? judge.warningCounts.blue : 0}</td>
            </tr>
            <tr class="subtotal">
                <td style="text-align: left; padding-left: 10px;">Compte</td>
                <td colspan="3" class="corner-red" style="text-align: center;">${judge.compteCounts ? judge.compteCounts.red : 0}</td>
                <td colspan="3" class="corner-blue" style="text-align: center;">${judge.compteCounts ? judge.compteCounts.blue : 0}</td>
            </tr>
            <tr class="subtotal">
                <td style="text-align: left; padding-left: 10px;">Sous TOTAUX 2</td>
                <td colspan="3" class="corner-red" style="text-align: center;">${judge.subtotals ? judge.subtotals.red2 : 0}</td>
                <td colspan="3" class="corner-blue" style="text-align: center;">${judge.subtotals ? judge.subtotals.blue2 : 0}</td>
            </tr>
            <tr>
                <td>Bonus</td>
                <td colspan="3" class="corner-red" style="text-align: center;">${judge.bonus ? judge.bonus.red : 0}</td>
                <td colspan="3" class="corner-blue" style="text-align: center;">${judge.bonus ? judge.bonus.blue : 0}</td>
            </tr>
            <tr class="total">
                <td>TOTAUX</td>
                <td colspan="3" class="corner-red" style="text-align: center;">${redTotal}</td>
                <td colspan="3" class="corner-blue" style="text-align: center;">${blueTotal}</td>
            </tr>
            <tr class="decision-row">
                <td>DÉCISION</td>
                <td colspan="7" class="decision-cell">${decision}</td>
            </tr>
        `;
    } else {
        bodyHTML += `
            <tr class="subtotal">
                <td style="text-align: left; padding-left: 10px;">Sous TOTAUX 1</td>
                <td colspan="2" class="corner-red" style="text-align: center;">${judge.subtotals ? judge.subtotals.red1 : 0}</td>
                <td colspan="2" class="corner-blue" style="text-align: center;">${judge.subtotals ? judge.subtotals.blue1 : 0}</td>
            </tr>
            <tr class="subtotal">
                <td style="text-align: left; padding-left: 10px;">**Avertissements**</td>
                <td colspan="2" class="corner-red" style="text-align: center;">${judge.warningCounts ? judge.warningCounts.red : 0}</td>
                <td colspan="2" class="corner-blue" style="text-align: center;">${judge.warningCounts ? judge.warningCounts.blue : 0}</td>
            </tr>
            <tr class="subtotal">
                <td style="text-align: left; padding-left: 10px;">Sous TOTAUX 2</td>
                <td colspan="2" class="corner-red" style="text-align: center;">${judge.subtotals ? judge.subtotals.red2 : 0}</td>
                <td colspan="2" class="corner-blue" style="text-align: center;">${judge.subtotals ? judge.subtotals.blue2 : 0}</td>
            </tr>
            <tr>
                <td>Bonus</td>
                <td colspan="2" class="corner-red" style="text-align: center;">${judge.bonus ? judge.bonus.red : 0}</td>
                <td colspan="2" class="corner-blue" style="text-align: center;">${judge.bonus ? judge.bonus.blue : 0}</td>
            </tr>
            <tr class="total">
                <td>TOTAUX</td>
                <td colspan="2" class="corner-red" style="text-align: center;">${redTotal}</td>
                <td colspan="2" class="corner-blue" style="text-align: center;">${blueTotal}</td>
            </tr>
            <tr class="decision-row">
                <td>DÉCISION</td>
                <td colspan="5" class="decision-cell">${decision}</td>
            </tr>
        `;
    }
    
    bodyHTML += '</tbody>';
    
    table.innerHTML = headerHTML + bodyHTML;
    return table;
}

function updateRecapTable() {
    const container = document.getElementById('recapTableContainer');
    if (!container) return;
    
    const judgeCount = Object.keys(app.data.judges).filter(k => app.data.judges[k].connected).length;
    if (judgeCount === 0) {
        container.innerHTML = `
            <div class="message info" style="margin: 20px 0;">
                <p>En attente des données des juges connectés...</p>
            </div>
        `;
        return;
    }
    
    // Créer le tableau récapitulatif
    const table = document.createElement('table');
    table.className = 'recap-table';
    
    // En-tête
    let headerHTML = `
        <thead>
            <tr>
                <th rowspan="2">Reprise</th>
                <th colspan="${judgeCount}" class="judge-header">Juges</th>
                <th rowspan="2" class="corner-red">Total Rouge</th>
                <th rowspan="2" class="corner-blue">Total Bleu</th>
            </tr>
            <tr>
    `;
    
    Object.keys(app.data.judges).forEach(judgeKey => {
        const judge = app.data.judges[judgeKey];
        if (judge.connected) {
            headerHTML += `<th class="judge-header">J${judge.id}</th>`;
        }
    });
    
    headerHTML += '</tr></thead>';
    
    // Corps du tableau
    let bodyHTML = '<tbody>';
    
    for (let round = 1; round <= app.session.rounds; round++) {
        bodyHTML += `<tr><td class="round-cell">R${round}</td>`;
        
        let redRoundTotal = 0;
        let blueRoundTotal = 0;
        
        Object.keys(app.data.judges).forEach(judgeKey => {
            const judge = app.data.judges[judgeKey];
            if (judge.connected) {
                const redScore = judge.scores ? (judge.scores[`red${round}`] || 0) : 0;
                const blueScore = judge.scores ? (judge.scores[`blue${round}`] || 0) : 0;
                
                redRoundTotal += parseInt(redScore) || 0;
                blueRoundTotal += parseInt(blueScore) || 0;
                
                bodyHTML += `<td>${redScore || '-'}/${blueScore || '-'}</td>`;
            }
        });
        
        bodyHTML += `
            <td class="score-red">${redRoundTotal}</td>
            <td class="score-blue">${blueRoundTotal}</td>
        </tr>`;
    }
    
    // Ligne des totaux
    bodyHTML += '<tr class="total-row"><td>TOTAUX</td>';
    
    let redGrandTotal = 0;
    let blueGrandTotal = 0;
    
    Object.keys(app.data.judges).forEach(judgeKey => {
        const judge = app.data.judges[judgeKey];
        if (judge.connected) {
            const redTotal = judge.totals ? judge.totals.red : 0;
            const blueTotal = judge.totals ? judge.totals.blue : 0;
            
            redGrandTotal += redTotal;
            blueGrandTotal += blueTotal;
            
            bodyHTML += `<td>${redTotal}/${blueTotal}</td>`;
        }
    });
    
    bodyHTML += `
        <td class="score-red">${redGrandTotal}</td>
        <td class="score-blue">${blueGrandTotal}</td>
    </tr>`;
    
    // Ligne des décisions
    bodyHTML += '<tr class="final-result"><td>DÉCISIONS</td>';
    
    let redWins = 0;
    let blueWins = 0;
    
    Object.keys(app.data.judges).forEach(judgeKey => {
        const judge = app.data.judges[judgeKey];
        if (judge.connected) {
            const decision = judge.decision || '-';
            bodyHTML += `<td>${decision}</td>`;
            
            if (decision.includes('ROUGE')) redWins++;
            else if (decision.includes('BLEU')) blueWins++;
        }
    });
    
    const finalResult = redWins > blueWins ? 'ROUGE GAGNE' : 
                      blueWins > redWins ? 'BLEU GAGNE' : 'ÉGALITÉ';
    
    bodyHTML += `
        <td class="final-result" colspan="2">${finalResult}</td>
    </tr>`;
    
    bodyHTML += '</tbody>';
    
    table.innerHTML = headerHTML + bodyHTML;
    container.innerHTML = '';
    container.appendChild(table);
}

function updateFinalResult() {
    const container = document.getElementById('finalResultContainer');
    if (!container) return;
    
    const connectedJudges = Object.keys(app.data.judges).filter(k => app.data.judges[k].connected);
    
    if (connectedJudges.length === 0) {
        container.innerHTML = `
            <div class="message info" style="margin: 20px 0;">
                <p>En attente des décisions de tous les juges...</p>
            </div>
        `;
        return;
    }
    
    // Compter les décisions
    let redWins = 0;
    let blueWins = 0;
    let draws = 0;
    
    const judgeDecisions = [];
    
    connectedJudges.forEach(judgeKey => {
        const judge = app.data.judges[judgeKey];
        const decision = judge.decision || 'En attente';
        
        judgeDecisions.push({
            id: judge.id,
            name: judge.name,
            decision: decision
        });
        
        if (decision.includes('ROUGE')) {
            redWins++;
        } else if (decision.includes('BLEU')) {
            blueWins++;
        } else if (decision.includes('ÉGALITÉ')) {
            draws++;
        }
    });
    
    // Déterminer le résultat final
    let finalResult = '';
    let resultClass = '';
    
    if (redWins > blueWins) {
        finalResult = `VICTOIRE ${app.data.fighters.red || 'TIREUR ROUGE'}`;
        resultClass = 'corner-red';
    } else if (blueWins > redWins) {
        finalResult = `VICTOIRE ${app.data.fighters.blue || 'TIREUR BLEU'}`;
        resultClass = 'corner-blue';
    } else {
        finalResult = 'ÉGALITÉ';
        resultClass = '';
    }
    
    // Créer l'affichage du résultat
    let resultHTML = `
        <div class="final-result-container">
            <div class="final-result-title">🏆 RÉSULTAT FINAL</div>
            <div class="final-result-details ${resultClass}">${finalResult}</div>
            <div class="final-result-details">
                Majorité: ${Math.max(redWins, blueWins)} sur ${connectedJudges.length} juges
            </div>
            
            <div class="majority-details">
                <h4>📊 Détail des décisions des juges:</h4>
    `;
    
    judgeDecisions.forEach(judge => {
        const winnerClass = judge.decision.includes('ROUGE') ? 'corner-red' : 
                           judge.decision.includes('BLEU') ? 'corner-blue' : '';
        
        resultHTML += `
            <div class="judge-vote">
                <span><strong>Juge ${judge.id} (${judge.name}):</strong></span>
                <span class="winner ${winnerClass}">${judge.decision}</span>
            </div>
        `;
    });
    
    resultHTML += `
            </div>
            
            <div style="margin-top: 20px; text-align: center;">
                <button class="button-success" onclick="exportAllFormats()">
                    📤 Exporter Résultat Complet
                </button>
            </div>
        </div>
    `;
    
    container.innerHTML = resultHTML;
}

// =====================
// INTERFACE JUGE
// =====================

let warnings = { red: {}, blue: {} };
let comptes = { red: {}, blue: {} };
let abandons = { red: false, blue: false };
let actionHistory = [];

function showJudgeInterface() {
    document.getElementById('judgeInterface').classList.remove('hidden');
    document.getElementById('contentArea').style.display = 'none';
    document.getElementById('syncIndicator').classList.remove('hidden');
    
    // Remplir les informations du juge
    document.getElementById('judgeNameField').value = app.session.judgeName;
    document.getElementById('judgeNumberField').value = app.session.judgeNumber;
    document.getElementById('judgeSessionCode').textContent = app.session.code;
    document.getElementById('judgeInfo').textContent = `${app.session.judgeName} (${app.session.judgeNumber})`;
    
    // Attendre la configuration de session
    setTimeout(() => {
        if (app.session.fightType) {
            updateJudgeTypeSelection();
            createJudgeScoringTable();
            updateCompletionIndicators();
        }
    }, 1000);
}

function updateJudgeTypeSelection() {
    const container = document.getElementById('judgeTypeSelection');
    if (!container) return;
    
    container.innerHTML = `
        <h3>Type de rencontre: ${getFightTypeLabel(app.session.fightType)}</h3>
        <p><strong>Nombre de reprises:</strong> ${app.session.rounds}</p>
    `;
}

function createJudgeScoringTable() {
    const table = document.getElementById('judgeScoringTable');
    const colgroup = document.getElementById('judgeColgroup');
    const tableHeader = document.getElementById('judgeTableHeader');
    const tableBody = document.getElementById('judgeTableBody');
    
    if (!table || !colgroup || !tableHeader || !tableBody) return;
    
    const isCombatType = isCombat();
    const activeRounds = app.session.rounds;
    
    // Définir les colonnes
    if (isCombatType) {
        colgroup.innerHTML = `
            <col style="width: 120px;">
            <col style="width: 60px;">
            <col style="width: 80px;">
            <col style="width: 60px;">
            <col style="width: 60px;">
            <col style="width: 60px;">
            <col style="width: 80px;">
            <col style="width: 60px;">
            <col style="width: 60px;">
        `;
        
        tableHeader.innerHTML = `
            <tr>
                <th rowspan="2">NOTATION</th>
                <th colspan="4" style="background-color: #ef5350; color: white;">COIN ROUGE</th>
                <th colspan="4" style="background-color: #42a5f5; color: white;">COIN BLEU</th>
            </tr>
            <tr>
                <th class="corner-red">Reprise</th>
                <th class="corner-red">NOTE</th>
                <th class="corner-red">AVT</th>
                <th class="corner-red">CPTE</th>
                <th class="corner-blue">Reprise</th>
                <th class="corner-blue">NOTE</th>
                <th class="corner-blue">AVT</th>
                <th class="corner-blue">CPTE</th>
            </tr>
        `;
    } else {
        colgroup.innerHTML = `
            <col style="width: 120px;">
            <col style="width: 60px;">
            <col style="width: 80px;">
            <col style="width: 60px;">
            <col style="width: 60px;">
            <col style="width: 80px;">
            <col style="width: 60px;">
        `;
        
        tableHeader.innerHTML = `
            <tr>
                <th rowspan="2">NOTATION</th>
                <th colspan="3" style="background-color: #ef5350; color: white;">COIN ROUGE</th>
                <th colspan="3" style="background-color: #42a5f5; color: white;">COIN BLEU</th>
            </tr>
            <tr>
                <th class="corner-red">Reprise</th>
                <th class="corner-red">NOTE</th>
                <th class="corner-red">AVT</th>
                <th class="corner-blue">Reprise</th>
                <th class="corner-blue">NOTE</th>
                <th class="corner-blue">AVT</th>
            </tr>
        `;
    }
    
    // Créer le corps du tableau
    const notationText = isCombatType ? 
        `Égalité: 2/2<br>Gagné: 3/2<br>Dominé: 3/1<br>Non décision: X/X<br>Avertissement: -1<br>Compte: -1<br>Bonus: +1` :
        `Égalité: 2/2<br>Gagné: 3/2<br>Dominé: 3/1<br>Non décision: X/X<br>Avertissement: -1<br>Bonus: +1`;
    
    let bodyHTML = '';
    
    // Initialiser les données de juge
    if (!warnings.red) warnings.red = {};
    if (!warnings.blue) warnings.blue = {};
    if (!comptes.red) comptes.red = {};
    if (!comptes.blue) comptes.blue = {};
    
    // Lignes de reprises
    for (let i = 1; i <= 5; i++) {
        const hiddenClass = i > activeRounds ? 'hidden-row' : '';
        const rowspanAttr = i === 1 ? `rowspan="${activeRounds}"` : '';
        const notationCell = i === 1 ? `<td ${rowspanAttr} style="vertical-align: top;" class="notation-cell"><small>${notationText}</small></td>` : '';
        
        if (isCombatType) {
            bodyHTML += `
                <tr id="judgeRound${i}" class="${hiddenClass}">
                    ${notationCell}
                    <td class="corner-red">${i}</td>
                    <td class="corner-red">
                        <select class="score-select" id="judgeRed${i}" onchange="validateAndUpdateJudgeScores(${i})">
                            <option value="">-</option>
                            <option value="3">3</option>
                            <option value="2">2</option>
                            <option value="1">1</option>
                        </select>
                    </td>
                    <td class="corner-red warning-cell" id="judgeRedAvtCell${i}" onclick="toggleJudgeWarning('red', ${i})"></td>
                    <td class="corner-red compte-cell" id="judgeRedCpteCell${i}" onclick="toggleJudgeCompte('red', ${i})"></td>
                    <td class="corner-blue">${i}</td>
                    <td class="corner-blue">
                        <select class="score-select" id="judgeBlue${i}" onchange="validateAndUpdateJudgeScores(${i})">
                            <option value="">-</option>
                            <option value="3">3</option>
                            <option value="2">2</option>
                            <option value="1">1</option>
                        </select>
                    </td>
                    <td class="corner-blue warning-cell" id="judgeBlueAvtCell${i}" onclick="toggleJudgeWarning('blue', ${i})"></td>
                    <td class="corner-blue compte-cell" id="judgeBlueCpteCell${i}" onclick="toggleJudgeCompte('blue', ${i})"></td>
                </tr>
            `;
        } else {
            bodyHTML += `
                <tr id="judgeRound${i}" class="${hiddenClass}">
                    ${notationCell}
                    <td class="corner-red">${i}</td>
                    <td class="corner-red">
                        <select class="score-select" id="judgeRed${i}" onchange="validateAndUpdateJudgeScores(${i})">
                            <option value="">-</option>
                            <option value="3">3</option>
                            <option value="2">2</option>
                            <option value="1">1</option>
                        </select>
                    </td>
                    <td class="corner-red warning-cell" id="judgeRedAvtCell${i}" onclick="toggleJudgeWarning('red', ${i})"></td>
                    <td class="corner-blue">${i}</td>
                    <td class="corner-blue">
                        <select class="score-select" id="judgeBlue${i}" onchange="validateAndUpdateJudgeScores(${i})">
                            <option value="">-</option>
                            <option value="3">3</option>
                            <option value="2">2</option>
                            <option value="1">1</option>
                        </select>
                    </td>
                    <td class="corner-blue warning-cell" id="judgeBlueAvtCell${i}" onclick="toggleJudgeWarning('blue', ${i})"></td>
                </tr>
            `;
        }
    }
    
    // Lignes de totaux
    if (isCombatType) {
        bodyHTML += `
            <tr class="subtotal">
                <td style="text-align: left; padding-left: 10px;">Sous TOTAUX 1</td>
                <td colspan="3" class="corner-red" style="text-align: center;"><span id="judgeRedSubtotal1">0</span></td>
                <td class="corner-red"></td>
                <td colspan="3" class="corner-blue" style="text-align: center;"><span id="judgeBlueSubtotal1">0</span></td>
                <td class="corner-blue"></td>
            </tr>
            <tr class="subtotal">
                <td style="text-align: left; padding-left: 10px;">**Avertissements**</td>
                <td colspan="3" class="corner-red" style="text-align: center;"><span id="judgeRedWarnings">0</span></td>
                <td class="corner-red"></td>
                <td colspan="3" class="corner-blue" style="text-align: center;"><span id="judgeBlueWarnings">0</span></td>
                <td class="corner-blue"></td>
            </tr>
            <tr class="subtotal">
                <td style="text-align: left; padding-left: 10px;">Compte</td>
                <td colspan="3" class="corner-red" style="text-align: center;"><span id="judgeRedComptes">0</span></td>
                <td class="corner-red"></td>
                <td colspan="3" class="corner-blue" style="text-align: center;"><span id="judgeBlueComptes">0</span></td>
                <td class="corner-blue"></td>
            </tr>
            <tr class="subtotal">
                <td style="text-align: left; padding-left: 10px;">Sous TOTAUX 2</td>
                <td colspan="3" class="corner-red" style="text-align: center;"><span id="judgeRedSubtotal2">0</span></td>
                <td class="corner-red"></td>
                <td colspan="3" class="corner-blue" style="text-align: center;"><span id="judgeBlueSubtotal2">0</span></td>
                <td class="corner-blue"></td>
            </tr>
            <tr>
                <td>Bonus</td>
                <td colspan="3" class="corner-red" style="text-align: center;">
                    <input type="number" class="score-input" id="judgeRedBonus" min="0" max="1" value="0" onchange="validateJudgeBonus()">
                </td>
                <td class="corner-red"></td>
                <td colspan="3" class="corner-blue" style="text-align: center;">
                    <input type="number" class="score-input" id="judgeBlueBonus" min="0" max="1" value="0" onchange="validateJudgeBonus()">
                </td>
                <td class="corner-blue"></td>
            </tr>
            <tr class="total">
                <td>TOTAUX</td>
                <td colspan="3" class="corner-red" style="text-align: center;"><span id="judgeRedTotal">0</span></td>
                <td class="corner-red abandon-cell" id="judgeAbandonRed" onclick="toggleJudgeAbandon('red')">ABANDON</td>
                <td colspan="3" class="corner-blue" style="text-align: center;"><span id="judgeBlueTotal">0</span></td>
                <td class="corner-blue abandon-cell" id="judgeAbandonBlue" onclick="toggleJudgeAbandon('blue')">ABANDON</td>
            </tr>
            <tr class="decision-row">
                <td>DÉCISION</td>
                <td colspan="8" class="decision-cell"><span id="judgeDecision">-</span></td>
            </tr>
        `;
    } else {
        bodyHTML += `
            <tr class="subtotal">
                <td style="text-align: left; padding-left: 10px;">Sous TOTAUX 1</td>
                <td colspan="2" class="corner-red" style="text-align: center;"><span id="judgeRedSubtotal1">0</span></td>
                <td class="corner-red"></td>
                <td colspan="2" class="corner-blue" style="text-align: center;"><span id="judgeBlueSubtotal1">0</span></td>
                <td class="corner-blue"></td>
            </tr>
            <tr class="subtotal">
                <td style="text-align: left; padding-left: 10px;">**Avertissements**</td>
                <td colspan="2" class="corner-red" style="text-align: center;"><span id="judgeRedWarnings">0</span></td>
                <td class="corner-red"></td>
                <td colspan="2" class="corner-blue" style="text-align: center;"><span id="judgeBlueWarnings">0</span></td>
                <td class="corner-blue"></td>
            </tr>
            <tr class="subtotal">
                <td style="text-align: left; padding-left: 10px;">Sous TOTAUX 2</td>
                <td colspan="2" class="corner-red" style="text-align: center;"><span id="judgeRedSubtotal2">0</span></td>
                <td class="corner-red"></td>
                <td colspan="2" class="corner-blue" style="text-align: center;"><span id="judgeBlueSubtotal2">0</span></td>
                <td class="corner-blue"></td>
            </tr>
            <tr>
                <td>Bonus</td>
                <td colspan="2" class="corner-red" style="text-align: center;">
                    <input type="number" class="score-input" id="judgeRedBonus" min="0" max="1" value="0" onchange="validateJudgeBonus()">
                </td>
                <td class="corner-red"></td>
                <td colspan="2" class="corner-blue" style="text-align: center;">
                    <input type="number" class="score-input" id="judgeBlueBonus" min="0" max="1" value="0" onchange="validateJudgeBonus()">
                </td>
                <td class="corner-blue"></td>
            </tr>
            <tr class="total">
                <td>TOTAUX</td>
                <td colspan="2" class="corner-red" style="text-align: center;"><span id="judgeRedTotal">0</span></td>
                <td class="corner-red abandon-cell" id="judgeAbandonRed" onclick="toggleJudgeAbandon('red')">ABANDON</td>
                <td colspan="2" class="corner-blue" style="text-align: center;"><span id="judgeBlueTotal">0</span></td>
                <td class="corner-blue abandon-cell" id="judgeAbandonBlue" onclick="toggleJudgeAbandon('blue')">ABANDON</td>
            </tr>
            <tr class="decision-row">
                <td>DÉCISION</td>
                <td colspan="6" class="decision-cell"><span id="judgeDecision">-</span></td>
            </tr>
        `;
    }
    
    tableBody.innerHTML = bodyHTML;
}

function updateCompletionIndicators() {
    const redIndicator = document.getElementById('judgeRedFighterIndicator');
    const blueIndicator = document.getElementById('judgeBlueFighterIndicator');
    
    if (redIndicator) {
        const hasRed = app.data.fighters.red && app.data.fighters.red.trim() !== '';
        redIndicator.className = `completion-indicator ${hasRed ? 'complete' : 'incomplete'}`;
    }
    
    if (blueIndicator) {
        const hasBlue = app.data.fighters.blue && app.data.fighters.blue.trim() !== '';
        blueIndicator.className = `completion-indicator ${hasBlue ? 'complete' : 'incomplete'}`;
    }
}

// =====================
// FONCTIONS CPTE JUGE COMPLÈTES
// =====================

function saveJudgeState() {
    const state = {
        warnings: JSON.parse(JSON.stringify(warnings)),
        comptes: JSON.parse(JSON.stringify(comptes)),
        abandons: JSON.parse(JSON.stringify(abandons)),
        scores: {},
        bonus: {
            red: safeGetElement('judgeRedBonus')?.value || '0',
            blue: safeGetElement('judgeBlueBonus')?.value || '0'
        }
    };
    
    // Sauvegarder les scores
    for (let i = 1; i <= 5; i++) {
        const redElement = safeGetElement(`judgeRed${i}`);
        const blueElement = safeGetElement(`judgeBlue${i}`);
        state.scores[`red${i}`] = redElement ? redElement.value : '';
        state.scores[`blue${i}`] = blueElement ? blueElement.value : '';
    }
    
    actionHistory.push(state);
    
    // Limiter l'historique à 50 actions
    if (actionHistory.length > 50) {
        actionHistory.shift();
    }
    
    // Activer le bouton annuler
    const undoButton = safeGetElement('judgeUndoButton');
    if (undoButton) undoButton.disabled = false;
}

function safeGetElement(id) {
    try {
        return document.getElementById(id);
    } catch (error) {
        console.warn(`Élément ${id} non trouvé:`, error);
        return null;
    }
}

function validateAndUpdateJudgeScores(round) {
    const redSelect = safeGetElement(`judgeRed${round}`);
    const blueSelect = safeGetElement(`judgeBlue${round}`);
    
    if (!redSelect || !blueSelect) return;
    
    const redValue = parseInt(redSelect.value) || 0;
    const blueValue = parseInt(blueSelect.value) || 0;
    
    // Si un des deux a la valeur 3, l'autre ne peut pas l'avoir
    if (redValue === 3 && blueValue === 3) {
        showNotification(`Reprise ${round}: Les deux tireurs ne peuvent pas avoir la note 3 simultanément!`, 'error');
        
        // Réinitialiser la dernière valeur modifiée
        if (document.activeElement === redSelect) {
            redSelect.value = '';
        } else {
            blueSelect.value = '';
        }
        return;
    }
    
    // Si les deux valeurs sont définies, vérifier les combinaisons valides
    if (redValue && blueValue) {
        const isValidCombination = 
            (redValue === 3 && blueValue === 2) ||
            (redValue === 2 && blueValue === 3) ||
            (redValue === 3 && blueValue === 1) ||
            (redValue === 1 && blueValue === 3) ||
            (redValue === 2 && blueValue === 2);
        
        if (!isValidCombination) {
            showNotification(`Reprise ${round}: Seuls les scores 3-2, 3-1 ou 2-2 sont autorisés!`, 'error');
            
            // Réinitialiser la dernière valeur modifiée
            if (document.activeElement === redSelect) {
                redSelect.value = '';
            } else {
                blueSelect.value = '';
            }
            return;
        }
    }
    
    // Sauvegarder l'état avant modification
    saveJudgeState();
    
    // Mettre à jour les totaux
    updateJudgeTotals();
    
    // Synchroniser avec le délégué
    syncJudgeData();
}

function toggleJudgeWarning(color, round) {
    saveJudgeState();
    
    if (!warnings[color]) warnings[color] = {};
    
    warnings[color][round] = !warnings[color][round];
    
    const cell = safeGetElement(`judge${color.charAt(0).toUpperCase() + color.slice(1)}AvtCell${round}`);
    if (cell) {
        if (warnings[color][round]) {
            cell.textContent = 'A';
            cell.classList.add('full');
        } else {
            cell.textContent = '';
            cell.classList.remove('full');
        }
    }
    
    updateJudgeTotals();
    syncJudgeData();
}

function toggleJudgeCompte(color, round) {
    if (!isCombat()) return; // Les comptes n'existent qu'en combat
    
    saveJudgeState();
    
    if (!comptes[color]) comptes[color] = {};
    
    comptes[color][round] = !comptes[color][round];
    
    const cell = safeGetElement(`judge${color.charAt(0).toUpperCase() + color.slice(1)}CpteCell${round}`);
    if (cell) {
        if (comptes[color][round]) {
            cell.textContent = 'C';
            cell.classList.add('full');
        } else {
            cell.textContent = '';
            cell.classList.remove('full');
        }
    }
    
    updateJudgeTotals();
    syncJudgeData();
}

function toggleJudgeAbandon(color) {
    saveJudgeState();
    
    abandons[color] = !abandons[color];
    
    const cell = safeGetElement(`judgeAbandon${color.charAt(0).toUpperCase() + color.slice(1)}`);
    if (cell) {
        if (abandons[color]) {
            cell.classList.add('abandoned');
            cell.textContent = 'ABANDON';
        } else {
            cell.classList.remove('abandoned');
            cell.textContent = 'ABANDON';
        }
    }
    
    updateJudgeTotals();
    syncJudgeData();
}

function validateJudgeBonus() {
    const redBonus = parseInt(safeGetElement('judgeRedBonus')?.value) || 0;
    const blueBonus = parseInt(safeGetElement('judgeBlueBonus')?.value) || 0;
    
    // Un seul bonus peut être attribué
    if (redBonus > 0 && blueBonus > 0) {
        showNotification('⚠️ Un seul bonus peut être attribué!', 'error');
        
        // Réinitialiser le dernier modifié
        if (document.activeElement === safeGetElement('judgeRedBonus')) {
            safeGetElement('judgeRedBonus').value = '0';
        } else {
            safeGetElement('judgeBlueBonus').value = '0';
        }
        return;
    }
    
    saveJudgeState();
    updateJudgeTotals();
    syncJudgeData();
}

function updateJudgeTotals() {
    let redSubtotal1 = 0;
    let blueSubtotal1 = 0;
    let redWarningCount = 0;
    let blueWarningCount = 0;
    let redCompteCount = 0;
    let blueCompteCount = 0;
    
    // Calculer les sous-totaux 1 (somme des scores)
    for (let i = 1; i <= app.session.rounds; i++) {
        const redScore = parseInt(safeGetElement(`judgeRed${i}`)?.value) || 0;
        const blueScore = parseInt(safeGetElement(`judgeBlue${i}`)?.value) || 0;
        
        redSubtotal1 += redScore;
        blueSubtotal1 += blueScore;
        
        // Compter les avertissements
        if (warnings.red && warnings.red[i]) redWarningCount++;
        if (warnings.blue && warnings.blue[i]) blueWarningCount++;
        
        // Compter les comptes (seulement en combat)
        if (isCombat()) {
            if (comptes.red && comptes.red[i]) redCompteCount++;
            if (comptes.blue && comptes.blue[i]) blueCompteCount++;
        }
    }
    
    // Calculer les sous-totaux 2 (après déduction des avertissements et comptes)
    const redSubtotal2 = redSubtotal1 - redWarningCount - redCompteCount;
    const blueSubtotal2 = blueSubtotal1 - blueWarningCount - blueCompteCount;
    
    // Ajouter les bonus
    const redBonus = parseInt(safeGetElement('judgeRedBonus')?.value) || 0;
    const blueBonus = parseInt(safeGetElement('judgeBlueBonus')?.value) || 0;
    
    // Calculer les totaux finaux
    let redTotal = redSubtotal2 + redBonus;
    let blueTotal = blueSubtotal2 + blueBonus;
    
    // Gérer les abandons
    if (abandons.red) redTotal = 0;
    if (abandons.blue) blueTotal = 0;
    
    // Mettre à jour l'affichage
    const redSubtotal1Element = safeGetElement('judgeRedSubtotal1');
    const blueSubtotal1Element = safeGetElement('judgeBlueSubtotal1');
    const redWarningsElement = safeGetElement('judgeRedWarnings');
    const blueWarningsElement = safeGetElement('judgeBlueWarnings');
    const redSubtotal2Element = safeGetElement('judgeRedSubtotal2');
    const blueSubtotal2Element = safeGetElement('judgeBlueSubtotal2');
    const redTotalElement = safeGetElement('judgeRedTotal');
    const blueTotalElement = safeGetElement('judgeBlueTotal');
    
    if (redSubtotal1Element) redSubtotal1Element.textContent = redSubtotal1;
    if (blueSubtotal1Element) blueSubtotal1Element.textContent = blueSubtotal1;
    if (redWarningsElement) redWarningsElement.textContent = redWarningCount;
    if (blueWarningsElement) blueWarningsElement.textContent = blueWarningCount;
    if (redSubtotal2Element) redSubtotal2Element.textContent = redSubtotal2;
    if (blueSubtotal2Element) blueSubtotal2Element.textContent = blueSubtotal2;
    if (redTotalElement) redTotalElement.textContent = redTotal;
    if (blueTotalElement) blueTotalElement.textContent = blueTotal;
    
    // Mettre à jour les comptes si en mode combat
    if (isCombat()) {
        const redComptesElement = safeGetElement('judgeRedComptes');
        const blueComptesElement = safeGetElement('judgeBlueComptes');
        if (redComptesElement) redComptesElement.textContent = redCompteCount;
        if (blueComptesElement) blueComptesElement.textContent = blueCompteCount;
    }
    
    // Calculer et afficher la décision
    updateJudgeDecision(redTotal, blueTotal);
    
    // Vérifier l'égalité et afficher l'avertissement si nécessaire
    checkEqualityWarning(redTotal, blueTotal);
}

function updateJudgeDecision(redTotal, blueTotal) {
    let decision = '';
    
    if (abandons.red && abandons.blue) {
        decision = 'DOUBLE ABANDON';
    } else if (abandons.red) {
        decision = `VICTOIRE ${app.data.fighters.blue || 'BLEU'} PAR ABANDON`;
    } else if (abandons.blue) {
        decision = `VICTOIRE ${app.data.fighters.red || 'ROUGE'} PAR ABANDON`;
    } else if (redTotal > blueTotal) {
        decision = `VICTOIRE ${app.data.fighters.red || 'ROUGE'} (${redTotal}-${blueTotal})`;
    } else if (blueTotal > redTotal) {
        decision = `VICTOIRE ${app.data.fighters.blue || 'BLEU'} (${blueTotal}-${redTotal})`;
    } else {
        decision = `ÉGALITÉ (${redTotal}-${blueTotal})`;
    }
    
    const decisionElement = safeGetElement('judgeDecision');
    if (decisionElement) {
        decisionElement.textContent = decision;
    }
}

function checkEqualityWarning(redTotal, blueTotal) {
    const warningElement = safeGetElement('judgeEqualityWarning');
    const redBonus = parseInt(safeGetElement('judgeRedBonus')?.value) || 0;
    const blueBonus = parseInt(safeGetElement('judgeBlueBonus')?.value) || 0;
    
    if (warningElement) {
        if (redTotal === blueTotal && !abandons.red && !abandons.blue && redBonus === 0 && blueBonus === 0) {
            warningElement.style.display = 'block';
            
            // Mettre en évidence les champs bonus
            const redBonusElement = safeGetElement('judgeRedBonus');
            const blueBonusElement = safeGetElement('judgeBlueBonus');
            if (redBonusElement) redBonusElement.classList.add('bonus-required');
            if (blueBonusElement) blueBonusElement.classList.add('bonus-required');
        } else {
            warningElement.style.display = 'none';
            
            // Retirer la mise en évidence
            const redBonusElement = safeGetElement('judgeRedBonus');
            const blueBonusElement = safeGetElement('judgeBlueBonus');
            if (redBonusElement) redBonusElement.classList.remove('bonus-required');
            if (blueBonusElement) blueBonusElement.classList.remove('bonus-required');
        }
    }
}

function syncJudgeData() {
    if (app.session.role !== 'judge') return;
    
    // Collecter toutes les données du juge
    const judgeData = {
        id: app.session.judgeId,
        name: app.session.judgeName,
        number: app.session.judgeNumber,
        connected: true,
        lastUpdate: Date.now(),
        warnings: warnings,
        comptes: comptes,
        abandons: abandons,
        scores: {},
        bonus: {
            red: parseInt(safeGetElement('judgeRedBonus')?.value) || 0,
            blue: parseInt(safeGetElement('judgeBlueBonus')?.value) || 0
        },
        totals: {
            red: parseInt(safeGetElement('judgeRedTotal')?.textContent) || 0,
            blue: parseInt(safeGetElement('judgeBlueTotal')?.textContent) || 0
        },
        subtotals: {
            red1: parseInt(safeGetElement('judgeRedSubtotal1')?.textContent) || 0,
            blue1: parseInt(safeGetElement('judgeBlueSubtotal1')?.textContent) || 0,
            red2: parseInt(safeGetElement('judgeRedSubtotal2')?.textContent) || 0,
            blue2: parseInt(safeGetElement('judgeBlueSubtotal2')?.textContent) || 0
        },
        warningCounts: {
            red: parseInt(safeGetElement('judgeRedWarnings')?.textContent) || 0,
            blue: parseInt(safeGetElement('judgeBlueWarnings')?.textContent) || 0
        },
        compteCounts: {
            red: parseInt(safeGetElement('judgeRedComptes')?.textContent) || 0,
            blue: parseInt(safeGetElement('judgeBlueComptes')?.textContent) || 0
        },
        decision: safeGetElement('judgeDecision')?.textContent || '-'
    };
    
    // Collecter les scores
    for (let i = 1; i <= 5; i++) {
        const redElement = safeGetElement(`judgeRed${i}`);
        const blueElement = safeGetElement(`judgeBlue${i}`);
        judgeData.scores[`red${i}`] = redElement ? redElement.value : '';
        judgeData.scores[`blue${i}`] = blueElement ? blueElement.value : '';
    }
    
    // Envoyer au délégué
    sendToAll({
        type: 'judge_data',
        data: judgeData
    }, 'high');
    
    showNotification('🔄 Données synchronisées', 'info', 1500);
}

function undoLastJudgeAction() {
    if (actionHistory.length === 0) {
        showNotification('❌ Aucune action à annuler', 'error');
        return;
    }
    
    const lastState = actionHistory.pop();
    
    // Restaurer l'état
    warnings = JSON.parse(JSON.stringify(lastState.warnings));
    comptes = JSON.parse(JSON.stringify(lastState.comptes));
    abandons = JSON.parse(JSON.stringify(lastState.abandons));
    
    // Restaurer les scores
    for (let i = 1; i <= 5; i++) {
        const redElement = safeGetElement(`judgeRed${i}`);
        const blueElement = safeGetElement(`judgeBlue${i}`);
        if (redElement) redElement.value = lastState.scores[`red${i}`] || '';
        if (blueElement) blueElement.value = lastState.scores[`blue${i}`] || '';
    }
    
    // Restaurer les bonus
    const redBonusElement = safeGetElement('judgeRedBonus');
    const blueBonusElement = safeGetElement('judgeBlueBonus');
    if (redBonusElement) redBonusElement.value = lastState.bonus.red;
    if (blueBonusElement) blueBonusElement.value = lastState.bonus.blue;
    
    // Restaurer l'affichage des avertissements et comptes
    for (let i = 1; i <= 5; i++) {
        ['red', 'blue'].forEach(color => {
            const warningCell = safeGetElement(`judge${color.charAt(0).toUpperCase() + color.slice(1)}AvtCell${i}`);
            if (warningCell) {
                if (warnings[color] && warnings[color][i]) {
                    warningCell.textContent = 'A';
                    warningCell.classList.add('full');
                } else {
                    warningCell.textContent = '';
                    warningCell.classList.remove('full');
                }
            }
            
            if (isCombat()) {
                const compteCell = safeGetElement(`judge${color.charAt(0).toUpperCase() + color.slice(1)}CpteCell${i}`);
                if (compteCell) {
                    if (comptes[color] && comptes[color][i]) {
                        compteCell.textContent = 'C';
                        compteCell.classList.add('full');
                    } else {
                        compteCell.textContent = '';
                        compteCell.classList.remove('full');
                    }
                }
            }
        });
    }
    
    // Restaurer l'affichage des abandons
    ['red', 'blue'].forEach(color => {
        const abandonCell = safeGetElement(`judgeAbandon${color.charAt(0).toUpperCase() + color.slice(1)}`);
        if (abandonCell) {
            if (abandons[color]) {
                abandonCell.classList.add('abandoned');
            } else {
                abandonCell.classList.remove('abandoned');
            }
        }
    });
    
    // Recalculer les totaux
    updateJudgeTotals();
    
    // Désactiver le bouton si plus d'historique
    if (actionHistory.length === 0) {
        const undoButton = safeGetElement('judgeUndoButton');
        if (undoButton) undoButton.disabled = true;
    }
    
    // Synchroniser
    syncJudgeData();
    
    showNotification('↶ Action annulée', 'success');
}

// =====================
// FONCTIONS D'EXPORT
// =====================

function exportJudgeToExcel() {
    showNotification('📊 Export Excel en cours...', 'info');
    // Implémentation de l'export Excel
}

function exportJudgeToMarkdown() {
    showNotification('📝 Export Markdown en cours...', 'info');
    // Implémentation de l'export Markdown
}

function exportCompleteMatchSheet() {
    showNotification('📊 Export feuille de match en cours...', 'info');
    // Implémentation de l'export complet
}

function exportOfficialReport() {
    showNotification('📋 Export rapport officiel en cours...', 'info');
    // Implémentation du rapport officiel
}

function exportRawData() {
    showNotification('📝 Export données brutes en cours...', 'info');
    // Implémentation de l'export JSON
}

function printFinalResult() {
    showNotification('🖨️ Préparation impression...', 'info');
    // Implémentation de l'impression
}

function exportAllFormats() {
    showNotification('🚀 Export de tous les formats en cours...', 'info');
    // Implémentation de l'export complet
}

// =====================
// FONCTIONS DE RÉINITIALISATION
// =====================

function showResetOptions() {
    const modal = document.getElementById('resetModal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function closeResetModal() {
    const modal = document.getElementById('resetModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function performPartialReset() {
    if (confirm('⚠️ Confirmer la réinitialisation partielle ? Tous les scores seront perdus mais les connexions seront conservées.')) {
        // Réinitialiser les données de combat
        app.data.fighters = { red: '', blue: '' };
        warnings = { red: {}, blue: {} };
        comptes = { red: {}, blue: {} };
        abandons = { red: false, blue: false };
        actionHistory = [];
        
        // Réinitialiser les données des juges (scores seulement)
        Object.keys(app.data.judges).forEach(judgeKey => {
            const judge = app.data.judges[judgeKey];
            if (judge.connected) {
                judge.scores = {};
                judge.warnings = { red: {}, blue: {} };
                judge.comptes = { red: {}, blue: {} };
                judge.abandons = { red: false, blue: false };
                judge.bonus = { red: 0, blue: 0 };
                judge.totals = { red: 0, blue: 0 };
                judge.decision = '-';
            }
        });
        
        // Envoyer la réinitialisation à tous les juges
        sendToAll({
            type: 'reset_partial',
            data: {}
        }, 'high');
        
        // Mettre à jour l'interface délégué
        document.getElementById('fighterRedName').value = '';
        document.getElementById('fighterBlueName').value = '';
        updateJudgeMonitoring();
        updateRecapTable();
        updateFinalResult();
        
        closeResetModal();
        showNotification('🔄 Réinitialisation partielle effectuée', 'success');
    }
}

function performCompleteReset() {
    if (confirm('⚠️ ATTENTION: Réinitialisation complète ! Toutes les données et connexions seront perdues. Confirmer ?')) {
        // Envoyer la réinitialisation complète
        sendToAll({
            type: 'reset_complete',
            data: {}
        }, 'high');
        
        // Fermer toutes les connexions
        app.webrtc.connections.forEach((conn, peerId) => {
            conn.close();
        });
        
        // Fermer le peer
        if (app.webrtc.peer) {
            app.webrtc.peer.destroy();
        }
        
        // Réinitialiser complètement l'application
        setTimeout(() => {
            window.location.reload();
        }, 1000);
        
        closeResetModal();
        showNotification('🔄 Réinitialisation complète en cours...', 'info');
    }
}

function handlePartialReset(data) {
    if (app.session.role === 'judge') {
        // Réinitialiser l'interface juge
        warnings = { red: {}, blue: {} };
        comptes = { red: {}, blue: {} };
        abandons = { red: false, blue: false };
        actionHistory = [];
        
        // Réinitialiser les champs
        for (let i = 1; i <= 5; i++) {
            const redElement = safeGetElement(`judgeRed${i}`);
            const blueElement = safeGetElement(`judgeBlue${i}`);
            if (redElement) redElement.value = '';
            if (blueElement) blueElement.value = '';
            
            ['red', 'blue'].forEach(color => {
                const warningCell = safeGetElement(`judge${color.charAt(0).toUpperCase() + color.slice(1)}AvtCell${i}`);
                if (warningCell) {
                    warningCell.textContent = '';
                    warningCell.classList.remove('full');
                }
                
                if (isCombat()) {
                    const compteCell = safeGetElement(`judge${color.charAt(0).toUpperCase() + color.slice(1)}CpteCell${i}`);
                    if (compteCell) {
                        compteCell.textContent = '';
                        compteCell.classList.remove('full');
                    }
                }
                
                const abandonCell = safeGetElement(`judgeAbandon${color.charAt(0).toUpperCase() + color.slice(1)}`);
                if (abandonCell) {
                    abandonCell.classList.remove('abandoned');
                }
            });
        }
        
        // Réinitialiser les bonus
        const redBonusElement = safeGetElement('judgeRedBonus');
        const blueBonusElement = safeGetElement('judgeBlueBonus');
        if (redBonusElement) redBonusElement.value = '0';
        if (blueBonusElement) blueBonusElement.value = '0';
        
        // Recalculer les totaux
        updateJudgeTotals();
        
        // Désactiver le bouton annuler
        const undoButton = safeGetElement('judgeUndoButton');
        if (undoButton) undoButton.disabled = true;
        
        showNotification('🔄 Interface réinitialisée', 'info');
    }
}

function handleCompleteReset() {
    showNotification('🔄 Réinitialisation complète reçue...', 'info');
    setTimeout(() => {
        window.location.reload();
    }, 1000);
}

function saveDelegateState(action, data) {
    app.history.delegate.push({
        timestamp: Date.now(),
        action: action,
        data: data
    });
    
    // Limiter l'historique
    if (app.history.delegate.length > 50) {
        app.history.delegate.shift();
    }
    
    // Activer le bouton annuler délégué
    const undoButton = document.getElementById('delegateUndoButton');
    if (undoButton) undoButton.disabled = false;
}

function undoDelegateLastAction() {
    if (app.history.delegate.length === 0) {
        showNotification('❌ Aucune action à annuler', 'error');
        return;
    }
    
    const lastAction = app.history.delegate.pop();
    
    switch (lastAction.action) {
        case 'MODIFICATION NOMS TIREURS':
            app.data.fighters.red = lastAction.data.previousRed;
            app.data.fighters.blue = lastAction.data.previousBlue;
            
            document.getElementById('fighterRedName').value = app.data.fighters.red;
            document.getElementById('fighterBlueName').value = app.data.fighters.blue;
            
            sendToAll({
                type: 'fighter_names',
                data: app.data.fighters
            }, 'normal');
            
            updateJudgeMonitoring();
            break;
    }
    
    // Désactiver le bouton si plus d'historique
    if (app.history.delegate.length === 0) {
        const undoButton = document.getElementById('delegateUndoButton');
        if (undoButton) undoButton.disabled = true;
    }
    
    showNotification('↶ Action déléguée annulée', 'success');
}
