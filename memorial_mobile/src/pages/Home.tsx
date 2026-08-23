import AppText from '@/atoms/AppText';
import {applyInitialState} from '@/hooks/executor';
import useSocket from '@/hooks/websocket';
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
} from '@/store/stateSlice';
import currentSlice, {selectedCategoryIdSlice} from '@/store/currentSlice';
import {
  DEFAULT_CATEGORIES,
  SortOption,
  TaskViewMode,
} from '@/constants/common.const';
import Category from '@/objects/Category';
import {removeAuth} from '@/store/accountSlice';

const Home = (): JSX.Element => {
  const dispatch = useDispatch();
  const tasks: {[key: string]: Object} = useSelector(tasksSlice);
  const categories: any = useSelector(categoriesSlice);
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
    return selectedCategory?.isDefault
      ? DEFAULT_CATEGORIES[selectedCategory.id]
      : categories[selectedCategoryId];
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

  const {socket, connected: socketConnected, onMessage, sendSync} = useSocket();

  useEffect(() => {
    if (!socketConnected) return;
    dispatch(clearTasks());
    dispatch(clearCategories());

    // dispatch(removeAuth());

    // TODO :: test token
    (async () => {
      const lastRemoteBlockNumber: any = await sendSync('lastBlockNumber');
      setRemoteBlockNumber(lastRemoteBlockNumber);
      const lastState: any = await sendSync('stateByBlockNumber', {
        blockNumber: lastRemoteBlockNumber,
      });
      try {
        applyInitialState(dispatch, lastRemoteBlockNumber, lastState);
        setLocalBlockNumber(lastRemoteBlockNumber);
      } catch (err) {
        console.error(err);
      }
    })();

    onMessage('broadcast_transaction', (data: any) => {
      console.log('tx', data);
    });
    onMessage('last_block_number', (data: any) => {
      const lastBlockNumber = data.data;
      console.log('last_block_number', lastBlockNumber);
      setRemoteBlockNumber(lastBlockNumber);
    });

    return () => {
      socket?.close();
    };
  }, [socketConnected]);

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
              {localBlockNumber}/{remoteBlockNumber}
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
