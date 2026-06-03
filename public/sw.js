// Service Worker para Chama na Mesa
// Responsável por exibir notificações na Central de Notificações do Windows

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Recebe mensagens do app principal para exibir notificações do sistema
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const data = event.data.payload;
    
    const title = `🔔 CHAMA NA MESA - ${data.urgencia || 'Nova Chamada'}`;
    const options = {
      body: data.body,
      icon: '/img/logo.png',
      badge: '/img/logo.png',
      tag: `chamada-${data.id}`,
      requireInteraction: true,
      silent: true,
      data: { id: data.id, url: data.url || '/' },
      actions: [
        { action: 'atender', title: '✅ Atender agora' },
        { action: 'agendar', title: '📅 Agendar' }
      ]
    };

    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  }
});

// Quando o usuário clica na notificação no painel do Windows
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const action = event.action;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Tenta focar uma janela já aberta do app
      for (const client of clientList) {
        if (client.url.includes(self.registration.scope)) {
          client.focus();
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            action: action || 'open',
            id: data.id
          });
          return;
        }
      }
      // Se nenhuma janela aberta, abre nova
      return self.clients.openWindow(data.url || '/');
    })
  );
});
