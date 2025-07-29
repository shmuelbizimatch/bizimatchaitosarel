"""
Claude AI client for interacting with Anthropic's API.
"""

import os
import logging
from typing import Dict, Any, Optional, List
from anthropic import Anthropic

logger = logging.getLogger(__name__)


class ClaudeClient:
    """Client for interacting with Claude AI."""
    
    def __init__(self, api_key: Optional[str] = None):
        """Initialize Claude client."""
        self.api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        if not self.api_key:
            raise ValueError("Anthropic API key is required")
            
        self.client = Anthropic(api_key=self.api_key)
        
    async def generate_response(
        self, 
        prompt: str, 
        system_prompt: Optional[str] = None,
        max_tokens: int = 4000,
        model: str = "claude-3-sonnet-20240229"
    ) -> str:
        """
        Generate a response from Claude.
        
        Args:
            prompt: User prompt
            system_prompt: System prompt for context
            max_tokens: Maximum tokens to generate
            model: Claude model to use
            
        Returns:
            Generated response text
        """
        try:
            messages = [{"role": "user", "content": prompt}]
            
            response = self.client.messages.create(
                model=model,
                max_tokens=max_tokens,
                messages=messages,
                system=system_prompt
            )
            
            return response.content[0].text
            
        except Exception as e:
            logger.error(f"Error generating Claude response: {str(e)}")
            raise
            
    async def generate_code(self, prompt: str, language: str = "python") -> str:
        """Generate code using Claude."""
        system_prompt = f"""You are an expert {language} developer. 
        Generate clean, well-documented, production-ready code based on the user's requirements.
        Include appropriate error handling and follow best practices."""
        
        return await self.generate_response(prompt, system_prompt)
        
    async def generate_prd(self, prompt: str) -> str:
        """Generate a Product Requirements Document from a high-level prompt."""
        system_prompt = """You are a product manager. Generate a comprehensive Product Requirements Document (PRD) 
        based on the user's high-level description. Include sections for:
        - Overview
        - Requirements
        - User Stories
        - Technical Specifications
        - Success Metrics"""
        
        return await self.generate_response(prompt, system_prompt)