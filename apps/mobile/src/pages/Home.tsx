import AppText from '@/atoms/AppText';
import {applyInitialState} from '@/hooks/executor';
import useSocket from '@/hooks/websocket';
import useSyncRead from '@/hooks/useSyncRead';
import TaskDetailModal from '@/modals/TaskDetailModal';
import SubTask from '@/objects/Subtask';
import Task from '@/objects/Task';
import TaskListView from '@/taskViews/TaskListView';
import moment from 'moment';
import React, {useCallback, useMemo, useState} from 'react';
import {useEffect} from 'react';
import {View, Text, ScrollView, Platform, TouchableOpacity} from 'react-native';
import Modal from 'react-native-modal';
import HomeStyle from './Home.style';
import {useDispatch, useSelector} from 'react-redux';
import {
  categoriesSlice,
  clearCategories,
  clearTasks,
  tasksSlice,
  stateOwnerSlice,
} from '@/store/stateSlice';
import currentSlice, {selectedCategoryIdSlice} from '@/store/currentSlice';
import {
  DEFAULT_CATEGORIES,
  SortOption,
  TaskViewMode,
} from '@/constants/common.const';
import Category from '@/objects/Category';
import {removeAuth, accountInfoSlice} from '@/store/accountSlice';
import LeftSidebar from '@/molecules/LeftSidebar';

const Home = (): JSX.Element => {
  const dispatch = useDispatch();
  const account = useSelector(accountInfoSlice);
  const owner = useSelector(stateOwnerSlice);
  const savedTasks = useSelector(tasksSlice), savedCategories = useSelector(categoriesSlice);
  const tasks: {[key: string]: Object} = owner === account.uid ? savedTasks : {};
  const categories: any = owner === account.uid ? savedCategories : {};
  const selectedCategoryId: any = useSelector(selectedCategoryIdSlice);

  const taskMap: {[key: string]: Task} = useMemo(() => {
    return Object.values(tasks).reduce((acc: any, task: Object) => {
      const newTask = Task.fromJSON(task);
      acc[newTask.id] = newTask;
      return acc;
    }, {});
  }, [tasks]);

  const [selectedTaskItemId, setSelectedTaskItemId] = useState<string | null>(
    null,
  );

  const currentTaskViewMode = TaskViewMode.LIST;
  const [currentSortOption, setCurrentSortOption] = useState(
    SortOption.DUE_DATE,
  );

  const [showTaskDetailModal, setShowTaskDetailModal] = useState(false);
  const [localBlockNumber, setLocalBlockNumber] = useState(0);
  const [remoteBlockNumber, setRemoteBlockNumber] = useState(0);

  const selectedTask: Task | null = useMemo(() => {
    return taskMap[selectedTaskItemId || ''] ?? null;
  }, [selectedTaskItemId, taskMap]);
  const selectedCategory: Category | null = useMemo(() => {
    return categories[selectedCategoryId] || null;
  }, [selectedCategoryId, categories]);

  const undoneTaskCounts = useMemo(() => {
    return Object.values(taskMap).filter((task: Task) => {
      if (task.done) return false;
      const categories: Map<string, Category> = task.categories;
      for (let [cid, category] of categories) {
        if (category.secret) return false;
      }
      return true;
    }).length;
  }, [taskMap]);

  const sync = useSyncRead();
  const {connected: legacyConnected, onMessage, sendSync} = useSocket(sync.mode === 'legacy');
  const socketConnected = sync.mode === 'v2' ? sync.connected : legacyConnected;

  useEffect(() => {
    if (!legacyConnected || sync.mode !== 'legacy') return;
    let stopped = false;

    // dispatch(removeAuth());

    // TODO :: test token
    const refresh = async () => {
      try {
      const lastRemoteBlockNumber: any = await sendSync('lastBlockNumber');
      if (stopped) return;
      setRemoteBlockNumber(lastRemoteBlockNumber);
      const lastState: any = await sendSync('stateByBlockNumber', {
        blockNumber: lastRemoteBlockNumber,
      });
      if (!stopped) {
        applyInitialState(dispatch, lastRemoteBlockNumber, lastState, sync.uid);
        setLocalBlockNumber(lastRemoteBlockNumber);
      }
      } catch (err) {
        console.error(err);
      }
    };
    void refresh();

    onMessage('broadcast_transaction', (data: any) => {
      console.log('tx', data);
    });
    onMessage('last_block_number', (data: any) => {
      const lastBlockNumber = data.data;
      console.log('last_block_number', lastBlockNumber);
      setRemoteBlockNumber(lastBlockNumber);
      void refresh();
    });

    return () => {
      stopped = true;
    };
  }, [legacyConnected,sync.mode,sync.uid,sendSync,onMessage,dispatch]);

  /* ----------------------- filter ----------------------- */
  const categoryFilter = useMemo((): Function => {
    switch (selectedCategoryId) {
      case DEFAULT_CATEGORIES.ALL:
        return () => true;
      case DEFAULT_CATEGORIES.TODAY:
        return (task: Task) =>
          task.dueDate != null && moment(task.dueDate).isSame(moment(), 'day');
      default:
        return (task: Task) => {
          if (
            selectedCategory != null &&
            selectedCategory.isDefault === false &&
            task.categories.has(selectedCategory.id) === false
          ) {
            return false;
          }
          return true;
        };
    }
  }, [selectedCategory]);

  const secretFilter = useCallback(
    (task: Task) => {
      try {
        const categories: Map<string, Category> = task.categories;
        if (categories == undefined) {
          console.log(task.categories, task instanceof Task, task);
          console.error('categories is undefined');
          return false;
        }
        for (let [cid, category] of categories.entries()) {
          if (category.secret === true && cid != selectedCategoryId)
            return false;
        }
        return true;
      } catch (err) {
        console.error(err);
        return false;
      }
    },
    [selectedCategoryId],
  );

  const totalFilter = useCallback(
    (task: Task) => {
      return categoryFilter(task) && secretFilter(task);
    },
    [categoryFilter, secretFilter],
  );

  /* ----------------------- Sorters ----------------------- */
  const sorter = useMemo(() => {
    const defaultSorter = (t1: Task, t2: Task) => 0;
    switch (currentSortOption) {
      case SortOption.IMPORTANT:
        return defaultSorter;
      case SortOption.REMAIN_DATE:
        return (t1: Task, t2: Task) => {
          if (t1.dueDate == null && t2.dueDate == null) return 0;
          if (t1.dueDate == null) return 1;
          if (t2.dueDate == null) return -1;
          return moment(t2.dueDate).diff(moment(t1.dueDate));
        };
      case SortOption.DUE_DATE:
        return (t1: Task, t2: Task) => {
          if (t1.dueDate == null && t2.dueDate == null) return 0;
          if (t1.dueDate == null) return 1;
          if (t2.dueDate == null) return -1;
          return moment(t1.dueDate).diff(moment(t2.dueDate));
        };
      case SortOption.CREATED_DATE:
        return (t1: Task, t2: Task) => {
          return moment(t2.createdAt).diff(moment(t1.createdAt));
        };
      default:
        return defaultSorter;
    }
  }, [currentSortOption]);

  const taskSelectHandler = (taskId: string) => {
    setSelectedTaskItemId(taskId);
    setShowTaskDetailModal(true);
  };

  const taskUnselectHandler = () => {
    setSelectedTaskItemId(null);
    setShowTaskDetailModal(false);
  };

  return (
    <View style={HomeStyle.homeContainer}>
      <LeftSidebar>
        <Text>Menu</Text>
      </LeftSidebar>
      <ScrollView stickyHeaderIndices={[0]} style={{width: '100%'}}>
        <View testID="header" style={HomeStyle.header}>
          <View testID="sync-section" style={HomeStyle.syncSection}>
            <AppText size={10} weight={500}>
              {socketConnected
                ? localBlockNumber !== remoteBlockNumber
                  ? '동기화 중'
                  : '동기화 완료'
                : '오프라인 모드'}
            </AppText>
            {/* <AppText size={10} weight={500}>
              동기화 중
            </AppText> */}
            <AppText size={10} weight={500}>
              {sync.mode === 'v2' ? sync.seq + '/' + sync.high : localBlockNumber + '/' + remoteBlockNumber}
            </AppText>
          </View>
          <View testID="title-section" style={HomeStyle.titleSection}>
            <AppText weight={500} size={25}>
              모든 할일 ({undoneTaskCounts})
            </AppText>
          </View>
          <View testID="option-section" style={HomeStyle.optionSection}>
            <View testID="view-options" style={HomeStyle.viewOptions}>
              {Object.values(TaskViewMode).map((mode, index) => {
                const styles: any[] = [HomeStyle.viewOption];
                const selected = mode === currentTaskViewMode;

                if (index < Object.values(TaskViewMode).length - 1) {
                  styles.push(HomeStyle.viewOption_notLast);
                }
                if (selected) {
                  styles.push(HomeStyle.viewOption_selected);
                }
                return (
                  <View testID="view-option" key={mode} style={styles}>
                    <AppText
                      style={[
                        HomeStyle.viewOptionText,
                        selected ? HomeStyle.viewOptionText_selected : {},
                      ]}
                      size={10}>
                      {mode}
                    </AppText>
                  </View>
                );
              })}
            </View>
            <View testID="extra-options" style={HomeStyle.viewOptions}>
              {Object.values(SortOption).map((option, index) => {
                const styles: any[] = [HomeStyle.viewOption];
                const selected = option === currentSortOption;

                if (index < Object.values(SortOption).length - 1) {
                  styles.push(HomeStyle.viewOption_notLast);
                }
                if (selected) {
                  styles.push(HomeStyle.viewOption_selected);
                }

                return (
                  <TouchableOpacity
                    testID="view-option"
                    key={option}
                    style={styles}
                    onPress={e => setCurrentSortOption(option)}>
                    <AppText
                      style={[
                        HomeStyle.viewOptionText,
                        selected ? HomeStyle.viewOptionText_selected : {},
                      ]}
                      size={10}>
                      {option} 순
                    </AppText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
        <View testID="body" style={HomeStyle.body}>
          <TaskListView
            taskMap={taskMap}
            onTaskSelect={taskSelectHandler}
            filter={totalFilter}
            sorter={sorter}
          />
        </View>
      </ScrollView>
      <TaskDetailModal
        task={selectedTask}
        visible={showTaskDetailModal && selectedTask !== null}
        onBackdropPress={taskUnselectHandler}
      />
    </View>
  );
};

export default Home;
