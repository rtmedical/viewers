/**
 * getPanelModule (RTV-164/165/166) — Course Timeline panel.
 * Opt in via '@ohif/extension-rt-timeline.panelModule.courseTimeline'.
 */
import React from 'react';
import CourseTimelinePanel from './CourseTimelinePanel';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager }: PanelModuleParams) {
  return [
    {
      name: 'courseTimeline',
      iconName: 'tab-studies',
      iconLabel: 'Course',
      label: 'Course Timeline',
      component: (props: Record<string, unknown>) => (
        <CourseTimelinePanel {...props} servicesManager={servicesManager} />
      ),
    },
  ];
}

export default getPanelModule;
