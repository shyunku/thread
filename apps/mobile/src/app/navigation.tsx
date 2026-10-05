import { ActivityIndicator, StatusBar, Text, View } from 'react-native';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  CalendarDays,
  Clock3,
  ListChecks,
  Settings,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from './AppContext';
import { useTheme } from '@/ui/theme';
import LoginScreen from '@/screens/auth/LoginScreen';
import SignupScreen from '@/screens/auth/SignupScreen';
import GoogleLinkScreen from '@/screens/auth/GoogleLinkScreen';
import LockMethodScreen from '@/screens/setup/LockMethodScreen';
import LockScreen from '@/screens/setup/LockScreen';
import SetupScreen from '@/screens/setup/SetupScreen';
import VaultProblemScreen from '@/screens/setup/VaultProblemScreen';
import TasksScreen from '@/screens/app/TasksScreen';
import CalendarScreen from '@/screens/app/CalendarScreen';
import TimelineScreen from '@/screens/app/TimelineScreen';
import SettingsScreen from '@/screens/app/SettingsScreen';
import TaskDetailScreen from '@/screens/app/TaskDetailScreen';
import SearchScreen from '@/screens/app/SearchScreen';
import CategoriesScreen from '@/screens/app/CategoriesScreen';
import DataSettingsScreen from '@/screens/app/DataSettingsScreen';
import ApproveDeviceScreen from '@/screens/app/ApproveDeviceScreen';
import KeyChangeScreen from '@/screens/app/KeyChangeScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabIcon({
  Icon,
  color,
  focused,
}: {
  Icon: typeof ListChecks;
  color: string;
  focused: boolean;
}) {
  const theme = useTheme();
  // Selected tab (user choice B, #96): a short bar on the top edge, accent icon and label.
  return (
    <View style={{ alignItems: 'center', paddingTop: 2 }}>
      {focused && (
        <View
          style={{
            position: 'absolute',
            top: -10,
            width: 28,
            height: 3,
            borderBottomLeftRadius: 3,
            borderBottomRightRadius: 3,
            backgroundColor: theme.accent,
          }}
        />
      )}
      <Icon color={color} size={20} />
    </View>
  );
}

function TabLabel({
  color,
  focused,
  children,
}: {
  color: string;
  focused: boolean;
  children: string;
}) {
  return (
    <Text style={{ color, fontSize: 11, fontWeight: focused ? '700' : '500' }}>
      {children}
    </Text>
  );
}
const label = (props: {
  color: string;
  focused: boolean;
  children: string;
}) => <TabLabel {...props} />;

const icon =
  (Icon: typeof ListChecks) =>
  ({ color, focused }: { color: string; focused: boolean }) =>
    <TabIcon Icon={Icon} color={color} focused={focused} />;

// Bottom tabs (user decision, #87): 할 일 · 캘린더 · 일정 · 설정.
function Tabs() {
  const theme = useTheme();
  const { prefs } = useApp();
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      initialRouteName={
        prefs.startTab === 'calendar'
          ? 'Calendar'
          : prefs.startTab === 'timeline'
          ? 'Timeline'
          : 'Tasks'
      }
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarLabel: label,
        tabBarInactiveTintColor: theme.muted,
        tabBarStyle: {
          backgroundColor: theme.panel,
          borderTopColor: theme.border,
          height: 62 + insets.bottom,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11 },
        sceneStyle: { backgroundColor: theme.canvas, paddingTop: insets.top },
      }}
    >
      <Tab.Screen
        name="Tasks"
        component={TasksScreen}
        options={{ title: '할 일', tabBarIcon: icon(ListChecks) }}
      />
      <Tab.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{ title: '캘린더', tabBarIcon: icon(CalendarDays) }}
      />
      <Tab.Screen
        name="Timeline"
        component={TimelineScreen}
        options={{ title: '일정', tabBarIcon: icon(Clock3) }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: '설정', tabBarIcon: icon(Settings) }}
      />
    </Tab.Navigator>
  );
}

// One stack whose screens follow the account state: signed out -> vault setup ->
// lock -> connect -> the app (React Navigation's conditional-screens pattern).
function Root() {
  const { ready, user, phase, setup } = useApp();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  if (!ready || (user && (!phase || (phase === 'UNLOCKED' && !setup)))) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.canvas,
        }}
      >
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  const padded = {
    contentStyle: { backgroundColor: theme.canvas, paddingTop: insets.top },
  };
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: theme.canvas },
      }}
    >
      {!user ? (
        <>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Signup" component={SignupScreen} />
          <Stack.Screen name="GoogleLink" component={GoogleLinkScreen} />
        </>
      ) : phase === 'ABSENT' ? (
        <Stack.Screen name="LockMethod" component={LockMethodScreen} />
      ) : phase === 'LOCKED' ? (
        <Stack.Screen name="Lock" component={LockScreen} />
      ) : phase === 'RECOVERY_REQUIRED' ? (
        <Stack.Screen name="VaultProblem" component={VaultProblemScreen} />
      ) : setup !== 'READY' ? (
        <Stack.Screen name="Setup" component={SetupScreen} />
      ) : (
        <>
          <Stack.Screen name="Main" component={Tabs} />
          <Stack.Screen
            name="TaskDetail"
            component={TaskDetailScreen}
            options={padded}
          />
          <Stack.Screen
            name="Search"
            component={SearchScreen}
            options={padded}
          />
          <Stack.Screen
            name="Categories"
            component={CategoriesScreen}
            options={padded}
          />
          <Stack.Screen
            name="DataSettings"
            component={DataSettingsScreen}
            options={padded}
          />
          <Stack.Screen
            name="ApproveDevice"
            component={ApproveDeviceScreen}
            options={{ animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="KeyChange"
            component={KeyChangeScreen}
            options={{ animation: 'slide_from_bottom', gestureEnabled: false }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function Navigation() {
  const theme = useTheme();
  const base = theme.scheme === 'light' ? DefaultTheme : DarkTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: theme.canvas,
      card: theme.panel,
      text: theme.text,
      border: theme.border,
      primary: theme.accent,
    },
  };
  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar
        barStyle={theme.scheme === 'light' ? 'dark-content' : 'light-content'}
      />
      <Root />
    </NavigationContainer>
  );
}
