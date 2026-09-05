import Category from '@/objects/Category';
import Task from '@/objects/Task';

const {createSlice, current} = require('@reduxjs/toolkit');

const initialState = Object.freeze({
  ownerUid: null,
  tasks: {},
  categories: {},
});

const stateSlice = createSlice({
  name: 'txState',
  initialState,
  reducers: {
    replaceState: (state: any, action: any) => {
      state.tasks = action.payload.tasks;
      state.categories = action.payload.categories;
      state.ownerUid = action.payload.ownerUid;
    },
    setTasks: (state: any, action: any) => {
      state.tasks = {...current(state).tasks, ...action.payload};
    },
    setCategories: (state: any, action: any) => {
      state.categories = {...current(state).categories, ...action.payload};
    },
    clearTasks: (state: any, action: any) => {
      state.tasks = initialState.tasks;
    },
    clearCategories: (state: any, action: any) => {
      state.categories = initialState.categories;
    },
    clearAll: (state: any, action: any) => {
      state = initialState;
    },
  },
});

export const {setTasks, setCategories, clearTasks, clearCategories, clearAll, replaceState} =
  stateSlice.actions;
export const tasksSlice = (state: any) => state.txState.tasks;
export const categoriesSlice = (state: any) => state.txState.categories;
export const stateOwnerSlice = (state: any) => state.txState.ownerUid;

export default stateSlice.reducer;
