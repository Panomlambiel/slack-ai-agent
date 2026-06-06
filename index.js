import pkg from '@slack/bolt';
const { App } = pkg;
import { WebClient } from '@slack/web-api';
import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { initDatabase, saveMemberAnalysis, markAsSentToSlack, closeDatabase } from './db.js';
dotenv.config();

const log ={
    info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
    error: (msg, ...args) => console.log(`[ERROR] ${msg}`, ...args),
    debug: (msg, ...args) => process.env.NODE_ENV === `development` && console.log(`[DEBUG] ${msg}`, ...args)
};
class SlackAIAgent {
    constructor() {
        this.app = express();
        this.slack = new App({
            token: process.env.SLACK_BOT_TOKEN,
            signingSecret: process.env.SLACK_SIGNING_SECRET,
            socketMode: true,
            appToken: process.env.SLACK_APP_TOKEN,
        });
        this.webClient = new WebClient(process.env.SLACK_BOT_TOKEN);
        this.setupSlackEvents();
        this.setupExpress();
    }
    setupSlackEvents() {
        this.slack.event('team_join', async ({ event }) => {
            try {
                log.info(`New member joined: ${event.user?.real_name || event.user?.name}`);
                const userInfo = await this.getUserInfo(event.user.id);
                await this.analyzeAndPostMember(userInfo);
            } catch (error) {
                log.error('Error processing team_join:', error.message);
            }
        });
        this.slack.event('member_joined_channel', async ({event}) => {
            try {

                if (event.channel_type === 'C') {
                    log.info(`Member ${event.user} joined channel ${event.channel}`);
                    const userInfo = await this.getUserInfo(event.user);
                    await this.analyzeAndPostMember(userInfo);
                }

             } catch (error) {
                    log.error('Error processing member_joined_channel:', error.message)
             }
        });
        this.slack.error(async (error) => log.error('Slack error:', error.message));
    }
    setupExpress() {
        this.app.use(express.json());

        this.app.get('/health', (req, res) => {
            res.json({ status: 'healthy', timestamp: new Date().toISOString() });
        });

        if (process.env.NODE_ENV === 'development') {
            this.app.post('/test/analyze-member', async (req, res) => {
                try {
                    const { memberInfo } = req.body;
                    if (!memberInfo) return res.status(400).json({ error: 'memberInfo is required' });
                    const analysis = await this.analyzeWithAI(memberInfo, []);
                    res.json({ success: true, analysis, timestamp: new Date().toISOString() });
                } catch (error) {
                    log.error('test/analyze error:', error.message);
                    res.status(500).json({ error: 'Analyze failed', message: error.message });
                }
            });
        }

        this.app.use((err, req, res, next) => {
            log.error('Express error:', err.message);
            res.status(500).json({ error: 'Internal Server Error' });
        });
    }
    async getUserInfo(userId) {
        const result = await this.webClient.users.info({ user: userId });
        const user = result.user || {};

        return {
            id: user.id,
            name: user.real_name || user.name,
            real_name: user.real_name,
            display_name: user.profile?.display_name,
            email: user.profile?.email,
            title: user.profile?.title,
            phone: user.profile?.phone,
            image_72: user.profile?.image_72,
            profile: {
                firstName: user.profile?.first_name,
                lastName: user.profile?.last_name,
                statusbar: user.profile?.status_text
            }
        };
    }
    async analyzeAndPostMember(memberInfo) {
        let analysisId = null;
        try {
            log.info(`processing member: ${memberInfo.name}`);
            const researchData = await this.doBasicResearch(memberInfo);
            const analysis = await this.analyzeWithAI(memberInfo, researchData);
            log.info(`saving analysis to database for ${memberInfo.name}`);
            analysisId = await saveMemberAnalysis(memberInfo, analysis, researchData);
            await this.postAnalysisToChannel(memberInfo, analysis, researchData);

            if (analysisId) {
                await markAsSentToSlack(analysisId);
            }
        } catch (error) {
            log.error(`Error processing ${memberInfo.name}:`, error.message);
            if (analysisId) {
                log.info(`Analysis ${analysisId} saved to database but not sent to slack due to error`);
            }
            throw error;
        }
    }
    async doBasicResearch(memberInfo) {
        const result = [];
        try {

                if (memberInfo.email && !this.isPersonalEmail(memberInfo.email)) {

                    const domain = memberInfo.email.split('@')[1];
               const companyInfo = await this.getCompanyInfo(domain);
                if (companyInfo) result.push(companyInfo);

                if (memberInfo.name) {
                    const githubInfo = await this.getGithubInfo(memberInfo.name);
                    if (githubInfo) result.push(githubInfo);
                }
            }
        }catch (error) {
            log.error('Research error:', error.message);
        }
        return result;
    }
    async getCompanyInfo(domain) {
        try {
            const response = await axios.get(`https://www.${domain}`,{
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }

            });

            const titleMatch = response.data.match(/<title>(.*?)<\/title>/i)
            const title = titleMatch ? titleMatch[1] : `company: ${domain}`;
            return {
                url: `https://www.${domain}`,
                title: title,
                content: `Company website for ${domain}`,
                type: 'company'
            }

        }catch (error) {
            log.error('could not fetch  ${domain}:', error.message)
                return null;
        }
    }
    async getGithubInfo(name) {
        try {

            const response = await axios.get(
                `https://api.github.com/search/users?q=${encodeURIComponent(name)}`,
               {timeout: 5000}
            );

            if (response.data.items && response.data.items.length > 0) {
                const user = response.data.items[0];
                return {
                    url: user.html_url,
                    title: `Github: ${user.login}`,
                    content: `${user.public_repos ?? 0} public repositories`,
                    type: 'github'
                }
            }
        }catch (error) {
            log.error('Github research error:', error.message)
        }
        return null;
    }

    async analyzeWithAI(memberInfo, researchData) {
        // Temporary placeholder implementation so the app can run without external AI calls.
        try {
            return {
                fitScore: 50,
                insights: ['No AI configured; manual review recommended'],
                recommendations: ['Send a personalized welcome message']
            };
        } catch (error) {
            log.error('AI analysis error:', error.message);
            return {
                fitScore: 50,
                insights: ['unable to complete analysis'],
                recommendations: ['Manual review recommended']
            };
        }
    }
    async postAnalysisToChannel(member, analysis,researchData) {
        const color = analysis.fitScore >= 80 ? '#36a64f' :
            analysis.fitScore >= 60 ? '#ffb84d'
                : analysis.fitScore >= 40 ? '#ffb84d' : '#ff4444';

        const blocks = [
            {
                type: 'header',
                text: {type: 'plain_text', text: `New Member: ${member.name}`}

            },
            {
                type: 'section',
                fields: [
                    { type: 'mrkdwn', text: `*Fit Score:* ${analysis.fitScore}/100`},
                    { type: 'mrkdwn', text:  `*Email:* ${member.email || 'Not provided'}`},
                    { type: 'mrkdwn', text: `*Title:* ${member.title || 'Not provided'}`},
                ]
            }
        ];

        if (analysis.insights.length > 0) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Insights:*\n${analysis.insights.map(i => `* ${i}`).join('\n')}`
                }
            })
        }
        if (analysis.recommendations.length > 0) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Recommendations:*\n${analysis.recommendations.map(i => `* ${i}`).join('\n')}`
                }
            })
        }

        blocks.push({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: `Analyzed: ${new Date().toISOString()}`
                }
            ]
        });

        await this.webClient.chat.postMessage({
            channel: process.env.SLACK_PRIVATE_CHANNEL_ID,
            text: `New Member Analysis: ${member.name} (${analysis.fitScore}/100)`,
            blocks
        });

        log.info(`Analysis posted to channel for ${member.name}`)
    }
    isPersonalEmail(email) {
        const personaldomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com'];
        if (!email || !email.includes('@')) return false;
        const domain = email.split('@')[1]?.toLowerCase();
        return personaldomains.includes(domain);
    }
    async start() {
        try {
            log.info('Initializing database...')
            try {
                await initDatabase();
            } catch (dbErr) {
                log.error('Database init failed; continuing without DB:', dbErr.message);
            }

            const port = process.env.PORT || 3000;
            this.server = this.app.listen(port, () => {
                log.info(`Express server running on port ${port}`);
            });
            await this.slack.start();
            log.info('Slack bot connected');

            log.info('Slack AI Agent is running!');

            if (process.env.NODE_ENV === 'development'){
                log.info(`Test endpoint: POST http://localhost:${port}/test/analyze-member`);
            }

        }catch (error) {
            log.error('Failed to start:', error.message)
            process.exit(1)
        }
    }
    async stop() {
        log.info('shutting down...')

        try {

            await this.slack.stop();
            if (this.server) {
                await new Promise(resolve => this.server.close(resolve));
            }
            await closeDatabase();
            log.info('Shutdown complete');

        }catch (error) {
            log.error('Shutdown error:', error.message)
        }
        process.exit(0)
    }
}
const agent = new SlackAIAgent();

process.on('SIGINT', () => agent.stop());
process.on('SIGTERM', () => agent.stop());

agent.start().catch(error => {
    console.error('Startup failed:', error.message);
    process.exit(1);
});

export default agent;