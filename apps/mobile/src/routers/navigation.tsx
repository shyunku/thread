import React, {useMemo} from 'react';
import Home from '@pages/Home';
import indexStyle from '@/styles/index.style';
import {configureStore} from '@reduxjs/toolkit';
import rootReducer from '@/reducers/rootReducer';
import {Platform} from 'react-native';
import 'react-native-gesture-handler';
import {NavigationContainer} from '@react-navigation/native';
import {createStackNavigator} from '@react-navigation/stack';
import Login from '@/pages/Login';
import Toast from 'react-native-toast-message';
import {useSelector} from 'react-redux';
import {accountAuthSlice} from '@/store/accountSlice';

const Stack = createStackNavigator();

const UnauthorizedNavigation = (): JSX.Element => {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{headerShown: false}}>
        <Stack.Screen name="Login" component={Login} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

const AuthorizedNavigation = (): JSX.Element => {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{headerShown: false}}>
        <Stack.Screen name="Home" component={Home} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

const Navigation = (): JSX.Element => {
  const authInfo = useSelector(accountAuthSlice);
  const authorized = useMemo(() => {
    return authInfo && authInfo.accessToken && authInfo.refreshToken;
  }, [authInfo]);

  //   console.log(authInfo);

  return authorized ? <AuthorizedNavigation /> : <UnauthorizedNavigation />;
};

export default Navigation;
