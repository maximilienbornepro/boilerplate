// Delivery Board Import - Figma Plugin
// This code runs in Figma's sandbox

// Show the UI
figma.showUI(__html__, { width: 400, height: 580 });

// Handle messages from the UI
figma.ui.onmessage = async (msg) => {
  console.log('Message received:', msg.type);

  if (msg.type === 'import-tasks') {
    const { projects, config } = msg;

    // Count total tasks
    let totalTasks = 0;
    if (projects) {
      for (let p = 0; p < projects.length; p++) {
        totalTasks += projects[p].tasks.length;
      }
    }

    console.log('Importing tasks:', totalTasks, 'from', projects ? projects.length : 0, 'projects');

    if (!projects || projects.length === 0 || totalTasks === 0) {
      figma.notify('Aucune tache a importer', { error: true });
      return;
    }

    // Layout configuration for FigJam board grid
    // These values should match your FigJam board layout
    const COLUMN_WIDTH = (config && config.columnWidth) || 560;
    const ROW_HEIGHT = (config && config.rowHeight) || 200;
    const PROJECT_GAP = 0; // Gap between projects vertically

    // Use viewport center as starting point (where user is looking)
    const viewportCenter = figma.viewport.center;
    const START_X = viewportCenter.x;
    const START_Y = viewportCenter.y;

    // Task card dimensions (fallback)
    const taskWidth = 390;
    const taskHeight = 180;
    const gap = 15;
    const cols = 6;

    const nodes = [];
    let currentRowOffset = 0; // Cumulative row offset for stacking projects

    let totalMepMarkers = 0;

    for (let p = 0; p < projects.length; p++) {
      const project = projects[p];
      const tasks = project.tasks;
      const mepMarkers = project.mepMarkers || [];

      console.log('Processing project:', project.projectId, 'with', tasks.length, 'tasks,', mepMarkers.length, 'MEP markers, rowOffset:', currentRowOffset);

      // Import tasks
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];

        try {
          console.log('Creating SVG for:', task.jiraKey);
          // Create node from SVG
          const node = figma.createNodeFromSvg(task.svg);
          console.log('Node created:', node ? node.name : 'null');

          // Calculate position (grid layout or use saved position)
          let x, y;

          if (task.position) {
            // Use saved position from delivery board
            // Position is based on FigJam grid (sprint columns and rows)
            // Add row offset to stack projects vertically
            x = START_X + task.position.startCol * COLUMN_WIDTH;
            y = START_Y + (task.position.row + currentRowOffset) * ROW_HEIGHT;
          } else {
            // Default grid layout (fallback)
            const col = i % cols;
            const row = Math.floor(i / cols);
            x = START_X + col * (taskWidth + gap);
            y = START_Y + (row + currentRowOffset) * ROW_HEIGHT;
          }

          node.x = x;
          node.y = y;
          node.name = task.jiraKey || ('Task ' + (i + 1));

          nodes.push(node);
        } catch (error) {
          console.error('Error creating node for task:', task.jiraKey, error);
        }
      }

      // Import MEP markers
      for (let m = 0; m < mepMarkers.length; m++) {
        const marker = mepMarkers[m];

        try {
          console.log('Creating MEP marker for:', marker.version);
          const node = figma.createNodeFromSvg(marker.svg);

          // Position based on columnPosition (0-6 representing position in PI)
          const x = START_X + marker.columnPosition * COLUMN_WIDTH - 60; // Center the marker (width 120 / 2)
          const y = START_Y + currentRowOffset * ROW_HEIGHT - 30; // Position above the first row

          node.x = x;
          node.y = y;
          node.name = 'MEP ' + marker.version;

          nodes.push(node);
          totalMepMarkers++;
        } catch (error) {
          console.error('Error creating MEP marker:', marker.version, error);
        }
      }

      // Update row offset for next project
      // Add maxRow + 1 (to account for 0-based indexing) + extra gap
      currentRowOffset += (project.maxRow + 1) + Math.ceil(PROJECT_GAP / ROW_HEIGHT);
    }

    // Group all nodes together for easy manipulation
    if (nodes.length > 0) {
      const group = figma.group(nodes, figma.currentPage);
      group.name = 'Delivery Import (' + projects.length + ' projets, ' + nodes.length + ' taches)';

      // Select the group
      figma.currentPage.selection = [group];

      // Zoom to fit
      figma.viewport.scrollAndZoomIntoView([group]);
    }

    const taskCount = nodes.length - totalMepMarkers;
    let message = taskCount + ' taches';
    if (totalMepMarkers > 0) {
      message += ', ' + totalMepMarkers + ' MEP';
    }
    message += ' (' + projects.length + ' projets)';
    figma.notify(message + ' importes !');
  }

  if (msg.type === 'import-releases') {
    const { svg, count } = msg;

    if (!svg) {
      figma.notify('Aucune release a importer', { error: true });
      return;
    }

    try {
      const node = figma.createNodeFromSvg(svg);

      // Center in viewport
      const viewport = figma.viewport.center;
      node.x = viewport.x - node.width / 2;
      node.y = viewport.y - node.height / 2;
      node.name = 'Releases Board';

      figma.currentPage.selection = [node];
      figma.viewport.scrollAndZoomIntoView([node]);

      figma.notify(`${count} releases importees !`);
    } catch (error) {
      console.error('Error creating releases node:', error);
      figma.notify('Erreur lors de l\'import', { error: true });
    }
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};
