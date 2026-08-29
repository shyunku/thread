import {DEFAULT_CATEGORIES} from '@/constants/common.const';

const {createSlice, current} = require('@reduxjs/toolkit');

const initialState = Object.freeze({
  selectedCategoryId: DEFAULT_CATEGORIES.ALL,
});

const _currentSlice = createSlice({
  name: 'current',
  initialState,
  reducers: {
    setSelectedCategoryId: (state: any, action: any) => {
      state = action.payload;
    },
  },
});

export const {setSelectedCategoryId} = _currentSlice.actions;
export const currentSlice = (state: any) => state.current;
export const selectedCategoryIdSlice = (state: any) =>
  state.current.selectedCategoryId;

export default _currentSlice.reducer;
