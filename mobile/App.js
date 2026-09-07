import { useEffect, useRef } from "react";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { ErrorProvider } from "./src/context/ErrorContext";
import { TabBar } from "./src/components/TabBar";
import { LoginScreen } from "./src/screens/LoginScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ControlsScreen } from "./src/screens/ControlsScreen";
import { MonitorScreen } from "./src/screens/MonitorScreen";
import { FilesScreen } from "./src/screens/FilesScreen";
import { TerminalScreen } from "./src/screens/TerminalScreen";
import { LogScreen } from "./src/screens/LogScreen";
import { routeForNotification } from "./src/notificationRoutes";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export const navigationRef = createNavigationContainerRef();

const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator();

function HomeStackScreen() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="HomeMain" component={HomeScreen} />
      <HomeStack.Screen name="Monitor" component={MonitorScreen} />
      <HomeStack.Screen name="Log" component={LogScreen} />
    </HomeStack.Navigator>
  );
}

function AppTabs() {
  // A tapped notification should land on the thing it is about. The push
  // payload carries {kind}; anything unrecognised just opens the app.
  const pendingRef = useRef(null);

  const go = (target) => {
    if (!target) return;
    if (!navigationRef.isReady()) {
      pendingRef.current = target;
      return;
    }
    navigationRef.navigate(target.tab, target.screen ? { screen: target.screen } : undefined);
  };

  useEffect(() => {
    // Cold start: the app was launched by the tap.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => go(routeForNotification(response)))
      .catch(() => {});

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      go(routeForNotification(response));
    });
    return () => sub.remove();
  }, []);

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        const target = pendingRef.current;
        pendingRef.current = null;
        go(target);
      }}
    >
      <Tab.Navigator
        tabBar={(props) => <TabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tab.Screen name="Home" component={HomeStackScreen} />
        <Tab.Screen name="Controls" component={ControlsScreen} />
        <Tab.Screen name="Files" component={FilesScreen} />
        <Tab.Screen name="Terminal" component={TerminalScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

function Root() {
  const { authenticated } = useAuth();
  return (
    <>
      <StatusBar style="light" />
      {authenticated ? <AppTabs /> : <LoginScreen />}
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ErrorProvider>
          <Root />
        </ErrorProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
