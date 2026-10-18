import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BookOpen, LayoutDashboard, Library, MessageCircle } from 'lucide-react-native';
import * as works from '../../features/works';
import { t } from '../../locales/zh-CN';
import { ArchivePlaceholder } from '../../screens/archive/ArchivePlaceholder';
import { ChaptersScreen } from '../../screens/work/ChaptersScreen';
import { OverviewScreen } from '../../screens/work/OverviewScreen';
import { PartnerPlaceholder } from '../../screens/partner/PartnerPlaceholder';
import { color as c } from '../../theme/tokens';
import { useLoad } from '../hooks';
import type { RootScreenProps, WorkTabParamList } from './types';
import { WorkContext } from './WorkContext';

const Tab = createBottomTabNavigator<WorkTabParamList>();

const ICON = { size: 24, strokeWidth: 1.75 };
type IconProps = { color: string };
const OverviewIcon = ({ color }: IconProps) => <LayoutDashboard color={color} {...ICON} />;
const ChaptersIcon = ({ color }: IconProps) => <BookOpen color={color} {...ICON} />;
const PartnerIcon = ({ color }: IconProps) => <MessageCircle color={color} {...ICON} />;
const ArchiveIcon = ({ color }: IconProps) => <Library color={color} {...ICON} />;

/**
 * Work space (UI §4.8, G01 §1): 概览 / 章节 / AI 伙伴 / 档案. The 概览 badge
 * shows open conflicts + pending proposals.
 */
export function WorkTabs({ route }: RootScreenProps<'Work'>) {
  const { workId, tab } = route.params;
  const pending = useLoad(
    async () => {
      const o = await works.overview(workId);
      return o.pending.conflicts + o.pending.proposals;
    },
    [workId],
    {
      events: {
        'proposals.changed': p => p.workId === workId,
        'conflicts.changed': p => p.workId === workId,
        'chapters.changed': p => p.workId === workId,
      },
    },
  );
  const badge = pending.data ? pending.data : undefined;

  return (
    <WorkContext.Provider value={workId}>
      <Tab.Navigator
        initialRouteName={tab ?? 'Overview'}
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: c.brand,
          tabBarInactiveTintColor: c.ink3,
          tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line },
          tabBarLabelStyle: { fontSize: 11 },
          tabBarAllowFontScaling: true,
          tabBarBadgeStyle: { backgroundColor: c.conf, color: c.white, fontSize: 11 },
          sceneStyle: { backgroundColor: c.paper },
        }}
      >
        <Tab.Screen
          name="Overview"
          component={OverviewScreen}
          options={{
            title: t.tabs.overview,
            tabBarBadge: badge,
            tabBarIcon: OverviewIcon,
          }}
        />
        <Tab.Screen
          name="Chapters"
          component={ChaptersScreen}
          options={{ title: t.tabs.chapters, tabBarIcon: ChaptersIcon }}
        />
        <Tab.Screen
          name="Partner"
          component={PartnerPlaceholder}
          options={{ title: t.tabs.partner, tabBarIcon: PartnerIcon }}
        />
        <Tab.Screen
          name="Archive"
          component={ArchivePlaceholder}
          options={{ title: t.tabs.archive, tabBarIcon: ArchiveIcon }}
        />
      </Tab.Navigator>
    </WorkContext.Provider>
  );
}


