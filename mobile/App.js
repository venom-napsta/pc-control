import { StatusBar } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { colors } from "./src/theme";
import { TabBar } from "./src/components/TabBar";
import { LoginScreen } from "./src/screens/LoginScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ControlsScreen } from "./src/screens/ControlsScreen";
import { MonitorScreen } from "./src/screens/MonitorScreen";
import { FilesScreen } from "./src/screens/FilesScreen";
import { TerminalScreen } from "./src/screens/TerminalScreen";
import { LogScreen } from "./src/screens/LogScreen";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

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
  return (
    <NavigationContainer>
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
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      {authenticated ? <AppTabs /> : <LoginScreen />}
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
