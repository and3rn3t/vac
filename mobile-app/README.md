# Roomba Mobile App Shell

This is a basic shell for a mobile application to control your Roomba locally.

## Future Development

This shell provides the foundation for:

### Planned Features
- Native mobile app (iOS/Android) using React Native
- Push notifications for cleaning completion
- Quick action shortcuts
- Widget support for home screen controls
- Offline scheduling
- Multi-room control interface
- Voice command integration

### Current Status
The mobile app is currently in shell form. The web portal provides full functionality and can be accessed from mobile browsers as a Progressive Web App (PWA).

### Getting Started

For now, use the web interface which is mobile-responsive:
1. Open your mobile browser
2. Navigate to `http://[server-ip]:3000`
3. Add to home screen for app-like experience

### Future Implementation

To build the native mobile app:

```bash
cd mobile-app
npm install
npm run android  # For Android
npm run ios      # For iOS
```

## Architecture

The mobile app will communicate with the same REST API and WebSocket endpoints as the web interface, ensuring feature parity across platforms.

### API Integration
- REST API: `http://[server-ip]:3000/api/*`
- WebSocket: `ws://[server-ip]:3000`

### Recommended Libraries
- **React Native**: Cross-platform mobile development
- **React Navigation**: Navigation and routing
- **Socket.io-client**: Real-time communication
- **AsyncStorage**: Local data persistence
- **React Native Push Notifications**: Alert system

## Contributing

Mobile app development contributions are welcome! This shell provides the basic structure for implementing native mobile features.
